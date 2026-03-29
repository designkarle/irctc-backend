const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { config } = require('../config');
const { inventoryClient, extractError: extractInventoryError } = require('./inventoryClient');
const { paymentClient, extractError: extractPaymentError } = require('./paymentClient');
const { acquireSeatLocks, releaseSeatLocks, forceReleaseSeatLocks } = require('../utils/distributedLock');
const saga = require('./saga.service');
const bookingProducer = require('../kafka/producer/booking.producer');
const { BadRequestError, NotFoundError, ConflictError, StaleStateError } = require('../utils/error');

// ─── Optimistic Lock Helper (CAS — Compare-And-Swap) ────────────────────────
// Atomically updates booking status ONLY IF the version hasn't changed since read.
// Returns the updated booking or throws StaleStateError if another process got there first.

const casUpdateBooking = async (bookingId, expectedVersion, data) => {
     const result = await prisma.booking.updateMany({
          where: { id: bookingId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
     });

     if (result.count === 0) {
          throw new StaleStateError(
               `Booking ${bookingId} was modified by another process (expected version ${expectedVersion})`
          );
     }
};

// ─── Idempotency Helper ──────────────────────────────────────────────────────

const checkIdempotency = async (key) => {
     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });
     if (existing) {
          logger.info(`Idempotent request: ${key}`);
          return existing.response;
     }
     return null;
};

const saveIdempotency = async (key, response) => {
     await prisma.idempotencyRecord.create({
          data: { eventKey: key, response },
     });
};

// ─── Create Booking ──────────────────────────────────────────────────────────

// --- SEGMENT BOOKING: Added fromStationId, toStationId, fromSeq, toSeq params ---
const createBooking = async (userId, scheduleId, seatIds, passengers, idempotencyKey, fromStationId, toStationId, fromSeq, toSeq) => {
     // 1. Validate input
     if (!scheduleId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
          throw new BadRequestError('scheduleId and seatIds (non-empty array) are required');
     }
     if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
          throw new BadRequestError('passengers (non-empty array) is required');
     }
     if (seatIds.length !== passengers.length) {
          throw new BadRequestError('Number of seats must match number of passengers');
     }
     if (!idempotencyKey) {
          throw new BadRequestError('idempotencyKey is required');
     }

     // --- SEGMENT BOOKING: Validate segment params if provided ---
     if (fromSeq && toSeq && fromSeq >= toSeq) {
          throw new BadRequestError('fromStation must come before toStation in route');
     }

     // 2. Check idempotency
     const cached = await checkIdempotency(`booking:${idempotencyKey}`);
     if (cached) return cached;

     // 3. Fetch schedule availability and seat details from inventory
     const availability = await inventoryClient.getAvailability(scheduleId);
     if (availability.status !== 'ACTIVE') {
          throw new BadRequestError('Schedule is not active');
     }

     // Prevent booking trains that have already departed
     if (new Date(availability.departureDate) < new Date()) {
          throw new BadRequestError('Cannot book a train that has already departed');
     }

     // --- SEGMENT BOOKING: Pass segment params to get segment-aware seat availability ---
     const seatData = await inventoryClient.getSeats(scheduleId, {
          fromSeq: fromSeq || undefined,
          toSeq: toSeq || undefined,
     });
     const seatMap = new Map(seatData.seats.map(s => [s.seatId, s]));

     // Verify all requested seats exist and are available
     const bookingSeats = [];
     let totalAmount = 0;
     for (const seatId of seatIds) {
          const seat = seatMap.get(seatId);
          if (!seat) {
               throw new NotFoundError(`Seat ${seatId} not found in schedule`);
          }
          // --- SEGMENT BOOKING: Use segmentStatus when available for segment-aware validation ---
          const isAvailable = (fromSeq && toSeq && seat.segmentStatus !== undefined)
               ? seat.segmentStatus === 'AVAILABLE'
               : seat.status === 'AVAILABLE';
          if (!isAvailable) {
               throw new ConflictError(`Seat #${seat.seatNumber} is not available for this segment`, 'SEATS_UNAVAILABLE');
          }
          bookingSeats.push(seat);
          totalAmount += seat.price;
     }

     // 4. Sort seatIds (deadlock prevention for distributed locks)
     const sortedSeatIds = [...seatIds].sort();

     // 5. Acquire Redis distributed locks (segment-aware keys for segment bookings)
     const { acquired, lockValue } = await acquireSeatLocks(
          scheduleId,
          sortedSeatIds,
          `pre-${Date.now()}`, // temporary ID before booking is created
          config.BOOKING_TTL_SECONDS,
          fromSeq,  // --- SEGMENT BOOKING: include in lock key
          toSeq     // --- SEGMENT BOOKING: include in lock key
     );

     if (!acquired) {
          throw new ConflictError(
               'One or more seats are being booked by another user. Please try again.',
               'SEATS_LOCKED'
          );
     }

     let booking;
     try {
          // 6. Create booking record in DB
          const lockExpiresAt = new Date(Date.now() + config.BOOKING_TTL_SECONDS * 1000);

          booking = await prisma.booking.create({
               data: {
                    userId,
                    scheduleId,
                    trainId: availability.trainId,
                    trainNumber: availability.trainNumber,
                    trainName: availability.trainName,
                    departureDate: new Date(availability.departureDate),
                    status: 'PENDING',
                    totalAmount,
                    seatCount: seatIds.length,
                    fromStationId: fromStationId || null,  // --- SEGMENT BOOKING
                    toStationId: toStationId || null,      // --- SEGMENT BOOKING
                    fromSeq: fromSeq || null,              // --- SEGMENT BOOKING
                    toSeq: toSeq || null,                  // --- SEGMENT BOOKING
                    idempotencyKey,
                    lockExpiresAt,
                    seats: {
                         create: bookingSeats.map((seat, index) => ({
                              seatId: seat.seatId,
                              seatNumber: seat.seatNumber,
                              seatType: seat.seatType,
                              price: seat.price,
                         })),
                    },
                    passengers: {
                         create: passengers.map((p, index) => ({
                              name: p.name,
                              age: p.age,
                              gender: p.gender,
                              seatId: seatIds[index] || null, // use original order to match user's intended seat assignment
                         })),
                    },
               },
               include: { seats: true, passengers: true },
          });

          // 7. Execute saga Step 1: Hold seats in inventory
          await saga.executeHoldSeats(booking, sortedSeatIds, config.LOCK_TTL_SECONDS, fromSeq, toSeq); // --- SEGMENT BOOKING

          // 8. Execute saga Step 2: Create payment order
          const paymentOrder = await saga.executeCreatePayment(booking);

          // Refresh booking after updates
          booking = await prisma.booking.findUnique({
               where: { id: booking.id },
               include: { seats: true, passengers: true },
          });

          // 9. Save idempotency
          const response = {
               bookingId: booking.id,
               status: booking.status,
               totalAmount: booking.totalAmount,
               lockExpiresAt: booking.lockExpiresAt,
               seats: booking.seats.map(s => ({
                    seatId: s.seatId,
                    seatNumber: s.seatNumber,
                    seatType: s.seatType,
                    price: s.price,
               })),
               passengers: booking.passengers.map(p => ({
                    name: p.name,
                    age: p.age,
                    gender: p.gender,
               })),
               paymentOrder: {
                    paymentOrderId: paymentOrder.paymentOrderId,
                    gatewayOrderId: paymentOrder.gatewayOrderId,
                    amount: paymentOrder.amount,
                    currency: paymentOrder.currency,
                    keyId: paymentOrder.keyId,
               },
          };

          await saveIdempotency(`booking:${idempotencyKey}`, response);

          return response;

     } catch (error) {
          // Compensate on failure
          logger.error(`Booking creation failed for user ${userId}`, { error: error.message });

          if (booking) {
               await saga.compensateAll(booking, sortedSeatIds);
               await prisma.booking.update({
                    where: { id: booking.id },
                    data: {
                         status: 'FAILED',
                         failureReason: error.response?.data?.message || error.message,
                    },
               });
          }

          // Release Redis locks (segment-aware)
          await releaseSeatLocks(scheduleId, sortedSeatIds, lockValue, fromSeq, toSeq);

          throw error;
     }
};

// ─── Handle Payment Success (Kafka consumer) ─────────────────────────────────

const handlePaymentSuccess = async (paymentOrderId, gatewayPaymentId, amount) => {
     const booking = await prisma.booking.findUnique({
          where: { paymentOrderId },
          include: { seats: true, passengers: true },
     });

     if (!booking) {
          logger.warn(`No booking found for paymentOrderId: ${paymentOrderId}`);
          return;
     }

     // Idempotent: already confirmed
     if (booking.status === 'CONFIRMED') {
          logger.info(`Booking ${booking.id} already confirmed`);
          return;
     }

     if (booking.status !== 'PAYMENT_PENDING') {
          logger.warn(`Booking ${booking.id} in unexpected status: ${booking.status}`);
          return;
     }

     const seatIds = booking.seats.map(s => s.seatId).sort();

     try {
          // Atomically claim this booking — if expiry job or cancel already changed it, bail out
          await casUpdateBooking(booking.id, booking.version, { status: 'CONFIRMING' });

          // Execute saga Step 3: Confirm seats in inventory
          await saga.executeConfirmSeats(booking, seatIds, booking.fromSeq, booking.toSeq); // --- SEGMENT BOOKING

          // Final status update (version was already incremented by CAS above)
          await prisma.booking.updateMany({
               where: { id: booking.id, status: 'CONFIRMING' },
               data: { status: 'CONFIRMED', version: { increment: 1 } },
          });

          // Release Redis locks (segment-aware)
          await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

          // Publish BOOKING_CONFIRMED (retried by producer — log but don't fail the booking)
          try {
               await bookingProducer.publishBookingConfirmed({
                    bookingId: booking.id,
                    userId: booking.userId,
                    scheduleId: booking.scheduleId,
                    trainNumber: booking.trainNumber,
                    trainName: booking.trainName,
                    departureDate: booking.departureDate,
                    seats: booking.seats.map(s => ({
                         seatNumber: s.seatNumber,
                         seatType: s.seatType,
                         price: s.price,
                    })),
                    passengers: booking.passengers.map(p => ({
                         name: p.name,
                         age: p.age,
                         gender: p.gender,
                    })),
                    totalAmount: booking.totalAmount,
               });
          } catch (err) {
               logger.error('CRITICAL: Failed to publish BOOKING_CONFIRMED after retries — notification/search may be stale', {
                    bookingId: booking.id,
                    error: err.message,
               });
          }

          logger.info(`Booking ${booking.id} confirmed successfully`);

     } catch (error) {
          // If StaleStateError, another process already handled this booking — do nothing
          if (error.code === 'STALE_STATE') {
               logger.info(`Booking ${booking.id} already handled by another process, skipping`);
               return;
          }

          logger.error(`Failed to confirm booking ${booking.id}`, { error: error.message });

          // Compensate: refund payment and release seats
          await saga.compensateAll(booking, seatIds);

          await prisma.booking.updateMany({
               where: { id: booking.id, status: { in: ['PAYMENT_PENDING', 'CONFIRMING'] } },
               data: {
                    status: 'FAILED',
                    failureReason: `confirm_failed: ${error.message}`,
                    version: { increment: 1 },
               },
          });

          await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

          try {
               await bookingProducer.publishBookingFailed({
                    bookingId: booking.id,
                    userId: booking.userId,
                    scheduleId: booking.scheduleId,
                    reason: 'confirm_seats_failed',
               });
          } catch (err) {
               logger.error('Failed to publish BOOKING_FAILED after retries', { bookingId: booking.id, error: err.message });
          }
     }
};

// ─── Handle Payment Failure (Kafka consumer) ─────────────────────────────────

const handlePaymentFailure = async (paymentOrderId, reason) => {
     const booking = await prisma.booking.findUnique({
          where: { paymentOrderId },
          include: { seats: true },
     });

     if (!booking) {
          logger.warn(`No booking found for paymentOrderId: ${paymentOrderId}`);
          return;
     }

     // Idempotent
     if (booking.status === 'FAILED' || booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
          logger.info(`Booking ${booking.id} already in terminal state: ${booking.status}`);
          return;
     }

     if (booking.status !== 'PAYMENT_PENDING') {
          logger.warn(`Booking ${booking.id} in unexpected status: ${booking.status}`);
          return;
     }

     const seatIds = booking.seats.map(s => s.seatId).sort();

     // Atomically claim this booking before compensating
     try {
          await casUpdateBooking(booking.id, booking.version, {
               status: 'FAILED',
               failureReason: reason || 'payment_failed',
          });
     } catch (error) {
          if (error.code === 'STALE_STATE') {
               logger.info(`Booking ${booking.id} already handled by another process, skipping`);
               return;
          }
          throw error;
     }

     // Compensate: release held seats
     await saga.compensateHoldSeats(booking, seatIds);

     // Release Redis locks (segment-aware)
     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

     // Publish BOOKING_FAILED
     try {
          await bookingProducer.publishBookingFailed({
               bookingId: booking.id,
               userId: booking.userId,
               scheduleId: booking.scheduleId,
               reason: reason || 'payment_failed',
          });
     } catch (err) {
          logger.error('Failed to publish BOOKING_FAILED after retries', { bookingId: booking.id, error: err.message });
     }

     logger.info(`Booking ${booking.id} failed: ${reason}`);
};

// ─── Cancel Booking ──────────────────────────────────────────────────────────

const cancelBooking = async (bookingId, userId) => {
     const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: { seats: true },
     });

     if (!booking) {
          throw new NotFoundError('Booking not found');
     }

     if (booking.userId !== userId) {
          throw new NotFoundError('Booking not found');
     }

     if (['CANCELLED', 'CANCELLING', 'FAILED', 'EXPIRED', 'CONFIRMING'].includes(booking.status)) {
          throw new ConflictError(`Booking is already ${booking.status}`);
     }

     const seatIds = booking.seats.map(s => s.seatId).sort();
     let refundInitiated = false;

     // Atomically claim this booking — prevents race with payment webhook or expiry job
     try {
          await casUpdateBooking(booking.id, booking.version, {
               status: 'CANCELLING',
               failureReason: 'user_cancelled',
          });
     } catch (error) {
          if (error.code === 'STALE_STATE') {
               // Re-read to give user accurate error
               const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
               throw new ConflictError(
                    `Booking status changed to ${fresh?.status || 'unknown'} while cancelling. Please refresh.`
               );
          }
          throw error;
     }

     if (booking.status === 'CONFIRMED') {
          // Cancel confirmed booking: release seats + refund
          await inventoryClient.cancelBooking(booking.scheduleId, booking.id, booking.userId);

          if (booking.paymentOrderId) {
               try {
                    const idempotencyKey = `${booking.id}-cancel-refund`;
                    await paymentClient.initiateRefund(
                         booking.paymentOrderId,
                         booking.totalAmount,
                         'user_cancelled',
                         idempotencyKey
                    );
                    refundInitiated = true;
               } catch (error) {
                    logger.error(`Failed to initiate refund for booking ${booking.id}`, {
                         error: error.message,
                    });
               }
          }
     } else if (['PAYMENT_PENDING', 'SEATS_HELD'].includes(booking.status)) {
          // Release held seats
          try {
               // --- SEGMENT BOOKING: Pass segment params for accurate release ---
               await inventoryClient.releaseSeats(booking.scheduleId, seatIds, booking.userId, booking.fromSeq, booking.toSeq);
          } catch (error) {
               logger.error(`Failed to release seats during cancel`, { error: error.message });
          }
     }

     // Final status (CANCELLING → CANCELLED)
     await prisma.booking.updateMany({
          where: { id: booking.id, status: 'CANCELLING' },
          data: {
               status: 'CANCELLED',
               version: { increment: 1 },
          },
     });

     // Release Redis locks (segment-aware)
     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

     // Publish BOOKING_CANCELLED
     try {
          await bookingProducer.publishBookingCancelled({
               bookingId: booking.id,
               userId: booking.userId,
               scheduleId: booking.scheduleId,
               reason: 'user_cancelled',
               refundAmount: refundInitiated ? booking.totalAmount : 0,
          });
     } catch (err) {
          logger.error('Failed to publish BOOKING_CANCELLED after retries', { bookingId: booking.id, error: err.message });
     }

     logger.info(`Booking ${booking.id} cancelled by user ${userId}`);

     return {
          bookingId: booking.id,
          status: 'CANCELLED',
          refundInitiated,
     };
};

// ─── Get Booking ─────────────────────────────────────────────────────────────

const getBooking = async (bookingId, userId) => {
     const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: {
               seats: { orderBy: { seatNumber: 'asc' } },
               passengers: true,
          },
     });

     if (!booking || booking.userId !== userId) {
          throw new NotFoundError('Booking not found');
     }

     return {
          id: booking.id,
          status: booking.status,
          scheduleId: booking.scheduleId,
          trainId: booking.trainId,
          trainNumber: booking.trainNumber,
          trainName: booking.trainName,
          departureDate: booking.departureDate,
          totalAmount: booking.totalAmount,
          seatCount: booking.seatCount,
          fromStationId: booking.fromStationId,  // --- SEGMENT BOOKING
          toStationId: booking.toStationId,      // --- SEGMENT BOOKING
          fromSeq: booking.fromSeq,              // --- SEGMENT BOOKING
          toSeq: booking.toSeq,                  // --- SEGMENT BOOKING
          paymentOrderId: booking.paymentOrderId,
          lockExpiresAt: booking.lockExpiresAt,
          failureReason: booking.failureReason,
          seats: booking.seats.map(s => ({
               seatId: s.seatId,
               seatNumber: s.seatNumber,
               seatType: s.seatType,
               price: s.price,
          })),
          passengers: booking.passengers.map(p => ({
               id: p.id,
               name: p.name,
               age: p.age,
               gender: p.gender,
               seatId: p.seatId,
          })),
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
     };
};

// ─── Get User Bookings ───────────────────────────────────────────────────────

const getUserBookings = async (userId, { status, page = 1, limit = 10 } = {}) => {
     const skip = (page - 1) * limit;
     const where = { userId };
     if (status) where.status = status.toUpperCase();

     const [bookings, total] = await Promise.all([
          prisma.booking.findMany({
               where,
               include: {
                    seats: { orderBy: { seatNumber: 'asc' } },
                    passengers: true,
               },
               orderBy: { createdAt: 'desc' },
               skip,
               take: limit,
          }),
          prisma.booking.count({ where }),
     ]);

     return {
          bookings: bookings.map(b => ({
               id: b.id,
               status: b.status,
               scheduleId: b.scheduleId,
               trainNumber: b.trainNumber,
               trainName: b.trainName,
               departureDate: b.departureDate,
               totalAmount: b.totalAmount,
               seatCount: b.seatCount,
               fromStationId: b.fromStationId,  // --- SEGMENT BOOKING
               toStationId: b.toStationId,      // --- SEGMENT BOOKING
               fromSeq: b.fromSeq,              // --- SEGMENT BOOKING
               toSeq: b.toSeq,                  // --- SEGMENT BOOKING
               seats: b.seats.map(s => ({
                    seatId: s.seatId,
                    seatNumber: s.seatNumber,
                    seatType: s.seatType,
                    price: s.price,
               })),
               passengers: b.passengers.map(p => ({
                    name: p.name,
                    age: p.age,
                    gender: p.gender,
               })),
               createdAt: b.createdAt,
          })),
          pagination: {
               page,
               limit,
               total,
               totalPages: Math.ceil(total / limit),
          },
     };
};

// ─── Verify Payment (client-side verification after Razorpay checkout) ───────

const verifyPayment = async (bookingId, userId, razorpayPaymentId, razorpaySignature) => {
     const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
     });

     if (!booking || booking.userId !== userId) {
          throw new NotFoundError('Booking not found');
     }

     if (!booking.paymentOrderId) {
          throw new BadRequestError('Booking has no payment order');
     }

     if (booking.status === 'CONFIRMED') {
          return { bookingId: booking.id, status: 'CONFIRMED', message: 'Already confirmed' };
     }

     if (booking.status !== 'PAYMENT_PENDING') {
          throw new ConflictError(`Booking is in ${booking.status} status, cannot verify payment`);
     }

     // Call payment service to verify and capture
     const result = await paymentClient.verifyPayment(
          booking.paymentOrderId,
          razorpayPaymentId,
          razorpaySignature
     );

     logger.info(`Payment verified for booking ${bookingId}`, { result });

     return {
          bookingId: booking.id,
          paymentStatus: result.status,
     };
};

// ─── Handle Schedule Cancelled (Kafka consumer) ─────────────────────────────
// When a schedule is cancelled, all active bookings on that schedule must be
// failed/cancelled so users aren't left with stranded tickets.

const handleScheduleCancelled = async (scheduleId) => {
     if (!scheduleId) {
          logger.warn('handleScheduleCancelled called without scheduleId');
          return;
     }

     const activeBookings = await prisma.booking.findMany({
          where: {
               scheduleId,
               status: { in: ['PENDING', 'SEATS_HELD', 'PAYMENT_PENDING', 'CONFIRMED'] },
          },
          include: { seats: true },
     });

     if (activeBookings.length === 0) {
          logger.info(`No active bookings to cancel for schedule ${scheduleId}`);
          return;
     }

     logger.info(`Cancelling ${activeBookings.length} active booking(s) due to schedule cancellation`, { scheduleId });

     for (const booking of activeBookings) {
          try {
               // CAS: claim ownership of this booking transition
               const claimed = await prisma.booking.updateMany({
                    where: {
                         id: booking.id,
                         version: booking.version,
                         status: { in: ['PENDING', 'SEATS_HELD', 'PAYMENT_PENDING', 'CONFIRMED'] },
                    },
                    data: {
                         status: 'CANCELLED',
                         failureReason: 'schedule_cancelled',
                         version: { increment: 1 },
                    },
               });

               if (claimed.count === 0) {
                    logger.info(`Booking ${booking.id} already handled, skipping schedule-cancel`);
                    continue;
               }

               const seatIds = booking.seats.map(s => s.seatId).sort();

               // Release Redis locks if any are still held
               await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

               // Initiate refund for confirmed bookings that had payment
               if (booking.status === 'CONFIRMED' && booking.paymentOrderId) {
                    try {
                         const idempotencyKey = `${booking.id}-schedule-cancel-refund`;
                         await paymentClient.initiateRefund(
                              booking.paymentOrderId,
                              booking.totalAmount,
                              'schedule_cancelled',
                              idempotencyKey
                         );
                    } catch (refundErr) {
                         logger.error(`Failed to initiate refund for booking ${booking.id} during schedule cancellation`, {
                              error: refundErr.message,
                         });
                    }
               }

               // Publish BOOKING_CANCELLED event
               try {
                    await bookingProducer.publishBookingCancelled({
                         bookingId: booking.id,
                         userId: booking.userId,
                         scheduleId: booking.scheduleId,
                         reason: 'schedule_cancelled',
                         refundAmount: booking.status === 'CONFIRMED' ? booking.totalAmount : 0,
                    });
               } catch (err) {
                    logger.error('Failed to publish BOOKING_CANCELLED for schedule cancellation', {
                         bookingId: booking.id,
                         error: err.message,
                    });
               }

               logger.info(`Booking ${booking.id} cancelled due to schedule cancellation`);
          } catch (error) {
               logger.error(`Failed to cancel booking ${booking.id} during schedule cancellation`, {
                    error: error.message,
               });
          }
     }
};

module.exports = {
     createBooking,
     handlePaymentSuccess,
     handlePaymentFailure,
     handleScheduleCancelled,
     cancelBooking,
     getBooking,
     getUserBookings,
     verifyPayment,
};
