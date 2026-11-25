const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { config } = require('../config');
const { inventoryClient, extractError: extractInventoryError } = require('./inventoryClient');
const { paymentClient, extractError: extractPaymentError } = require('./paymentClient');
const { userClient } = require('./userClient');
const { stationClient } = require('./stationClient');
const { acquireSeatLocks, releaseSeatLocks, forceReleaseSeatLocks } = require('../utils/distributedLock');
const saga = require('./saga.service');
const outbox = require('../utils/outbox');
const { KAFKA_TOPICS } = require('../../../shared/constants/kafka-topics');
const { BadRequestError, NotFoundError, ConflictError, StaleStateError } = require('../utils/error');

// ─── B1: booking events go through the transactional outbox ──────────────────
//
// These were published after the status update committed, wrapped in a try/catch
// that logged and moved on — one of them literally logs
// "CRITICAL: ... notification/search may be stale". A Kafka outage meant a
// confirmed, paid-for booking whose owner never received a ticket, with no record
// that the notification was owed and no way to replay it.
//
// The event row is now written in the same transaction as the status change, so
// the two are atomic, and the relay delivers it whenever Kafka comes back.
//
// Note on ordering: notification payloads carry enriched fields (user email,
// station names) that require HTTP calls. Those MUST be fetched before the
// transaction opens — never hold a database transaction across a network call.

const enqueueBookingEvent = (tx, topic, bookingId, payload) =>
     outbox.enqueue(tx, { topic, key: `booking-${bookingId}`, payload });

/** Gather the notification fields for a booking. Best effort — never throws. */
const fetchBookingEnrichment = async (booking, { withStations = false } = {}) => {
     const [userInfo, fromStationName, toStationName] = await Promise.all([
          fetchUserForNotification(booking.userId),
          withStations ? fetchStationName(booking.fromStationId) : Promise.resolve(null),
          withStations ? fetchStationName(booking.toStationId) : Promise.resolve(null),
     ]);
     return { userInfo: userInfo || {}, fromStationName, toStationName };
};

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

// ─── Notification Enrichment Helpers ─────────────────────────────────────────
// Looks up user (and optionally stations) so booking events can carry email/firstName
// directly. Failures here must never break the booking workflow — log and return null.

const fetchUserForNotification = async (userId) => {
     try {
          const user = await userClient.getUserById(userId);
          return user ? { email: user.email, firstName: user.firstName } : {};
     } catch (err) {
          logger.warn('Failed to enrich booking event with user details', {
               userId,
               error: err.message,
          });
          return {};
     }
};

const fetchStationName = async (stationId) => {
     if (!stationId) return null;
     try {
          const station = await stationClient.getStationById(stationId);
          return station ? station.name : null;
     } catch (err) {
          // A 404 here is a wiring bug, not a transient failure — the enrichment is
          // best-effort, so it degrades silently and can go unnoticed for a long time.
          // Log it at error level so a broken internal route is actually visible.
          if (err.response?.status === 404) {
               logger.error('Station lookup returned 404 — internal route may be misconfigured', {
                    stationId,
                    url: err.config?.url,
               });
          } else {
               logger.warn('Failed to enrich booking event with station name', {
                    stationId,
                    error: err.message,
               });
          }
          return null;
     }
};

// ─── Idempotency Helpers ─────────────────────────────────────────────────────
// Claim-then-work, not check-then-work. The old version did a findUnique up front
// and the insert only at the very end, leaving the entire booking flow as a window
// in which two requests carrying the same key both saw "not seen yet" and both ran.
//
// Now the unique constraint on eventKey is what arbitrates, and it does so before
// any seats are held or any payment order is created.

// How long an IN_PROGRESS claim is honoured before it is treated as abandoned.
// Must comfortably exceed a worst-case createBooking (4 inter-service calls, each
// up to 3 retries) so we never steal a claim from a request that is still running.
const IDEMPOTENCY_CLAIM_TTL_MS = 2 * 60 * 1000;

/**
 * Take ownership of an idempotency key.
 * @returns {Promise<{claimed: true} | {replay: object}>}
 *          `replay` — the key is already COMPLETED; return this stored response.
 *          `claimed` — this caller now owns the key and must complete or release it.
 * @throws  {ConflictError} REQUEST_IN_PROGRESS — a live duplicate is mid-flight.
 */
const claimIdempotency = async (key) => {
     try {
          await prisma.idempotencyRecord.create({
               data: { eventKey: key, status: 'IN_PROGRESS' },
          });
          return { claimed: true };
     } catch (error) {
          // P2002 = unique violation on eventKey. Anything else is a real failure.
          if (error.code !== 'P2002') throw error;
     }

     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });

     if (!existing) {
          // Raced against a release between our insert and our read — safe to retry.
          throw new ConflictError(
               'Request is already being processed. Please retry.',
               'REQUEST_IN_PROGRESS'
          );
     }

     if (existing.status === 'COMPLETED') {
          logger.info(`Idempotent replay: ${key}`);
          return { replay: existing.response };
     }

     const claimAgeMs = Date.now() - new Date(existing.updatedAt).getTime();

     if (claimAgeMs < IDEMPOTENCY_CLAIM_TTL_MS) {
          throw new ConflictError(
               'A request with this idempotencyKey is already in progress. Please retry shortly.',
               'REQUEST_IN_PROGRESS'
          );
     }

     // Abandoned claim — the owning process died mid-booking. Take it over, but only
     // if nobody else has touched the row since we read it (CAS on updatedAt), so two
     // simultaneous takeovers cannot both win.
     const takeover = await prisma.idempotencyRecord.updateMany({
          where: { eventKey: key, status: 'IN_PROGRESS', updatedAt: existing.updatedAt },
          data: { status: 'IN_PROGRESS', processedAt: new Date() },
     });

     if (takeover.count === 0) {
          throw new ConflictError(
               'A request with this idempotencyKey is already in progress. Please retry shortly.',
               'REQUEST_IN_PROGRESS'
          );
     }

     logger.warn(`Took over abandoned idempotency claim: ${key}`, { claimAgeMs });
     return { claimed: true };
};

const completeIdempotency = async (key, response) => {
     await prisma.idempotencyRecord.update({
          where: { eventKey: key },
          data: { status: 'COMPLETED', response },
     });
};

/**
 * Drop an unfinished claim so the caller can retry with the same key.
 * Only ever removes IN_PROGRESS rows — a COMPLETED response is never discarded.
 */
const releaseIdempotency = async (key) => {
     try {
          await prisma.idempotencyRecord.deleteMany({
               where: { eventKey: key, status: 'IN_PROGRESS' },
          });
     } catch (error) {
          // Non-fatal: the claim will age out via IDEMPOTENCY_CLAIM_TTL_MS.
          logger.warn(`Failed to release idempotency claim ${key}`, { error: error.message });
     }
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

     // 2. Claim the idempotency key BEFORE doing any work. A concurrent duplicate
     //    now loses here — on the unique constraint — instead of racing all the way
     //    through seat holds and payment-order creation alongside us.
     const idempotencyEventKey = `booking:${idempotencyKey}`;
     const claim = await claimIdempotency(idempotencyEventKey);
     if (claim.replay) return claim.replay;

     // From here on every exit path must either complete or release the claim.
     const sortedSeatIds = [...seatIds].sort(); // sorted: deadlock prevention for distributed locks
     let booking;
     let lockValue = null;

     try {
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

          // 4. Acquire Redis distributed locks (segment-aware keys for segment bookings)
          const lockResult = await acquireSeatLocks(
               scheduleId,
               sortedSeatIds,
               `pre-${Date.now()}`, // temporary ID before booking is created
               config.BOOKING_TTL_SECONDS,
               fromSeq,  // --- SEGMENT BOOKING: include in lock key
               toSeq     // --- SEGMENT BOOKING: include in lock key
          );

          if (!lockResult.acquired) {
               throw new ConflictError(
                    'One or more seats are being booked by another user. Please try again.',
                    'SEATS_LOCKED'
               );
          }
          lockValue = lockResult.lockValue;

          // 5. Create booking record in DB
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

          // 6. Execute saga Step 1: Hold seats in inventory
          await saga.executeHoldSeats(booking, sortedSeatIds, config.LOCK_TTL_SECONDS, fromSeq, toSeq); // --- SEGMENT BOOKING

          // 7. Execute saga Step 2: Create payment order
          const paymentOrder = await saga.executeCreatePayment(booking);

          // Refresh booking after updates
          booking = await prisma.booking.findUnique({
               where: { id: booking.id },
               include: { seats: true, passengers: true },
          });

          // 8. Build the response and mark the claim COMPLETED
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

          await completeIdempotency(idempotencyEventKey, response);

          return response;

     } catch (error) {
          // Compensate on failure
          logger.error(`Booking creation failed for user ${userId}`, { error: error.message });

          // Only roll back saga steps if a booking was actually created — i.e. if real
          // work happened downstream. Failures before that point (schedule inactive,
          // seat unavailable, lock contention) have nothing to compensate, and running
          // compensateAll for them would refund payments that never existed.
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

          // Release Redis locks (segment-aware). No-op when we never acquired them.
          await releaseSeatLocks(scheduleId, sortedSeatIds, lockValue, fromSeq, toSeq);

          // Free the key so the user can legitimately retry with the same idempotencyKey.
          await releaseIdempotency(idempotencyEventKey);

          throw error;
     }
};

// ─── Orphaned Payment Refund ─────────────────────────────────────────────────
// A payment can be captured AFTER the booking has already reached a terminal
// state — the classic case is a user completing checkout a few seconds after
// the expiry job released their seats (BOOKING_TTL_SECONDS elapsed).
//
// Ignoring that event means the gateway has the money, the user has no ticket,
// and nothing in the system will ever notice. Always refund instead.

const TERMINAL_STATUSES = ['EXPIRED', 'FAILED', 'CANCELLED'];

const refundOrphanedPayment = async (booking, gatewayPaymentId, amount) => {
     const refundAmount = typeof amount === 'number' && amount > 0 ? amount : booking.totalAmount;

     if (!booking.paymentOrderId) {
          logger.error(
               'CRITICAL: payment succeeded for a booking with no paymentOrderId — manual reconciliation required',
               { bookingId: booking.id, gatewayPaymentId, amount: refundAmount }
          );
          return;
     }

     // Record the intent before calling out, so a crash mid-refund is visible in the saga log.
     const sagaLog = await prisma.sagaLog.create({
          data: {
               bookingId: booking.id,
               step: 'CREATE_PAYMENT',
               status: 'COMPENSATING',
               request: {
                    reason: 'late_payment_refund',
                    bookingStatus: booking.status,
                    paymentOrderId: booking.paymentOrderId,
                    gatewayPaymentId,
                    amount: refundAmount,
               },
          },
     });

     try {
          // Dedicated idempotency key: independent of whatever compensation already ran
          // for this booking, and safe under Kafka redelivery.
          const result = await paymentClient.initiateRefund(
               booking.paymentOrderId,
               refundAmount,
               `late_payment_after_${booking.status.toLowerCase()}`,
               `${booking.id}-late-payment-refund`
          );

          // Enrich before the transaction — HTTP must never run inside one.
          const { userInfo } = await fetchBookingEnrichment(booking);

          // Mark the compensation done and queue the customer notification together.
          // Telling the user a refund is coming is the only signal they will get, so
          // it must not be lost if Kafka happens to be down at this moment.
          await prisma.$transaction(async (tx) => {
               await tx.sagaLog.update({
                    where: { id: sagaLog.id },
                    data: { status: 'COMPENSATED', response: result },
               });

               await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CANCELLED, booking.id, {
                    bookingId: booking.id,
                    userId: booking.userId,
                    email: userInfo.email,
                    firstName: userInfo.firstName,
                    scheduleId: booking.scheduleId,
                    reason: 'late_payment_refunded',
                    refundAmount,
                    cancelledAt: new Date().toISOString(),
               });
          });

          logger.info(`Refunded late payment for ${booking.status} booking ${booking.id}`, {
               paymentOrderId: booking.paymentOrderId,
               amount: refundAmount,
          });

          return result;

     } catch (error) {
          const errorMsg = extractPaymentError(error).message;

          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'FAILED', error: errorMsg },
          });

          logger.error(
               'CRITICAL: failed to refund late payment — money captured with no ticket issued',
               {
                    bookingId: booking.id,
                    paymentOrderId: booking.paymentOrderId,
                    gatewayPaymentId,
                    amount: refundAmount,
                    error: errorMsg,
               }
          );

          // Rethrow so the consumer retries and, failing that, the message lands in the
          // DLQ. An unrefunded capture must never be swallowed.
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

     // Money was captured but the booking is already dead — refund it.
     if (TERMINAL_STATUSES.includes(booking.status)) {
          logger.warn(
               `Payment captured for booking ${booking.id} already in terminal status ${booking.status} — refunding`,
               { paymentOrderId, gatewayPaymentId }
          );
          await refundOrphanedPayment(booking, gatewayPaymentId, amount);
          return;
     }

     // CONFIRMING / CANCELLING are transient: another process owns this booking right
     // now and will resolve it (or the stuck-booking sweeper will). Don't interfere.
     if (booking.status !== 'PAYMENT_PENDING') {
          logger.warn(`Booking ${booking.id} in transient status ${booking.status} — leaving to the owning process`);
          return;
     }

     const seatIds = booking.seats.map(s => s.seatId).sort();

     try {
          // Atomically claim this booking — if expiry job or cancel already changed it, bail out
          await casUpdateBooking(booking.id, booking.version, { status: 'CONFIRMING' });

          // Execute saga Step 3: Confirm seats in inventory
          await saga.executeConfirmSeats(booking, seatIds, booking.fromSeq, booking.toSeq); // --- SEGMENT BOOKING

          // Enrich BEFORE opening the transaction — these are HTTP calls.
          const { userInfo, fromStationName, toStationName } =
               await fetchBookingEnrichment(booking, { withStations: true });

          // B1: the CONFIRMED transition and the ticket notification commit together.
          // Previously the publish sat outside, and its failure handler logged
          // "CRITICAL: ... may be stale" — a paid, confirmed booking whose owner
          // never got a ticket and nothing to replay from.
          const confirmed = await prisma.$transaction(async (tx) => {
               const result = await tx.booking.updateMany({
                    where: { id: booking.id, status: 'CONFIRMING' },
                    data: { status: 'CONFIRMED', version: { increment: 1 } },
               });

               if (result.count === 0) return false;

               await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CONFIRMED, booking.id, {
                    bookingId: booking.id,
                    userId: booking.userId,
                    email: userInfo.email,
                    firstName: userInfo.firstName,
                    scheduleId: booking.scheduleId,
                    trainNumber: booking.trainNumber,
                    trainName: booking.trainName,
                    fromStationName,
                    toStationName,
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
                    confirmedAt: new Date().toISOString(),
               });

               return true;
          });

          if (!confirmed) {
               logger.info(`Booking ${booking.id} left CONFIRMING before we could finalise — another process owns it`);
               return;
          }

          // Release Redis locks (segment-aware)
          await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

          logger.info(`Booking ${booking.id} confirmed successfully`);

     } catch (error) {
          // Another process claimed this booking between our read and our CAS. The common
          // case is the expiry job winning by milliseconds — which leaves the capture
          // orphaned exactly like the terminal-status branch above, so re-check and refund.
          if (error.code === 'STALE_STATE') {
               const fresh = await prisma.booking.findUnique({ where: { id: booking.id } });

               if (fresh && TERMINAL_STATUSES.includes(fresh.status)) {
                    logger.warn(
                         `Booking ${booking.id} moved to ${fresh.status} while confirming — refunding captured payment`,
                         { paymentOrderId, gatewayPaymentId }
                    );
                    await refundOrphanedPayment(fresh, gatewayPaymentId, amount);
                    return;
               }

               logger.info(`Booking ${booking.id} already handled by another process, skipping`);
               return;
          }

          logger.error(`Failed to confirm booking ${booking.id}`, { error: error.message });

          // Compensate: refund payment and release seats
          await saga.compensateAll(booking, seatIds);

          const { userInfo } = await fetchBookingEnrichment(booking);

          await prisma.$transaction(async (tx) => {
               const result = await tx.booking.updateMany({
                    where: { id: booking.id, status: { in: ['PAYMENT_PENDING', 'CONFIRMING'] } },
                    data: {
                         status: 'FAILED',
                         failureReason: `confirm_failed: ${error.message}`,
                         version: { increment: 1 },
                    },
               });

               if (result.count === 0) return;

               await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_FAILED, booking.id, {
                    bookingId: booking.id,
                    userId: booking.userId,
                    email: userInfo.email,
                    firstName: userInfo.firstName,
                    scheduleId: booking.scheduleId,
                    reason: 'confirm_seats_failed',
                    failedAt: new Date().toISOString(),
               });
          });

          await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);
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

     // Enrich before claiming, so the notification can be enqueued in the same
     // transaction as the status change (HTTP inside a transaction is never OK).
     const { userInfo } = await fetchBookingEnrichment(booking);

     // Atomically claim this booking AND record the notification, before compensating.
     const claimed = await prisma.$transaction(async (tx) => {
          const result = await tx.booking.updateMany({
               where: { id: booking.id, version: booking.version },
               data: {
                    status: 'FAILED',
                    failureReason: reason || 'payment_failed',
                    version: { increment: 1 },
               },
          });

          if (result.count === 0) return false;

          await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_FAILED, booking.id, {
               bookingId: booking.id,
               userId: booking.userId,
               email: userInfo.email,
               firstName: userInfo.firstName,
               scheduleId: booking.scheduleId,
               reason: reason || 'payment_failed',
               failedAt: new Date().toISOString(),
          });

          return true;
     });

     if (!claimed) {
          logger.info(`Booking ${booking.id} already handled by another process, skipping`);
          return;
     }

     // Compensate: release held seats
     await saga.compensateHoldSeats(booking, seatIds);

     // Release Redis locks (segment-aware)
     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

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
          try {
               await inventoryClient.cancelBooking(booking.scheduleId, booking.id, booking.userId);
          } catch (error) {
               logger.error(`Failed to release seats in inventory for booking ${booking.id}`, {
                    error: error.message,
               });
               // Roll back from CANCELLING to CONFIRMED so the user can retry
               await prisma.booking.updateMany({
                    where: { id: booking.id, status: 'CANCELLING' },
                    data: {
                         status: 'CONFIRMED',
                         failureReason: null,
                         version: { increment: 1 },
                    },
               });
               throw error;
          }

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
     } else if (['PENDING', 'PAYMENT_PENDING', 'SEATS_HELD'].includes(booking.status)) {
          // Release held seats.
          //
          // PENDING is included deliberately: the hold-seats saga step may have landed
          // in inventory even though the booking row had not been advanced yet. It used
          // to match neither branch, so the seats stayed LOCKED in the database until the
          // lock-expiry job swept them up to LOCK_TTL_SECONDS later. Unlocking seats that
          // were never held is a harmless no-op, so this is safe either way.
          try {
               // --- SEGMENT BOOKING: Pass segment params for accurate release ---
               await inventoryClient.releaseSeats(booking.scheduleId, seatIds, booking.userId, booking.fromSeq, booking.toSeq, booking.id);
          } catch (error) {
               logger.error(`Failed to release seats during cancel`, { error: error.message });
          }
     }

     const { userInfo } = await fetchBookingEnrichment(booking);

     // Final status (CANCELLING → CANCELLED) and the cancellation notice commit
     // together — the notice carries the refund amount, which is the only
     // confirmation the user gets that their money is on the way back.
     await prisma.$transaction(async (tx) => {
          const result = await tx.booking.updateMany({
               where: { id: booking.id, status: 'CANCELLING' },
               data: {
                    status: 'CANCELLED',
                    version: { increment: 1 },
               },
          });

          if (result.count === 0) return;

          await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CANCELLED, booking.id, {
               bookingId: booking.id,
               userId: booking.userId,
               email: userInfo.email,
               firstName: userInfo.firstName,
               scheduleId: booking.scheduleId,
               reason: 'user_cancelled',
               refundAmount: refundInitiated ? booking.totalAmount : 0,
               cancelledAt: new Date().toISOString(),
          });
     });

     // Release Redis locks (segment-aware)
     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

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
          // The user paid, but the booking died first (usually expiry). We refuse to
          // capture here; if the gateway captured anyway, the payment.success consumer
          // refunds it. Say so, rather than leaving them wondering about their money.
          if (TERMINAL_STATUSES.includes(booking.status)) {
               throw new ConflictError(
                    `This booking is ${booking.status.toLowerCase()} and can no longer be confirmed. ` +
                    `If your payment went through, it will be refunded automatically.`,
                    'BOOKING_NOT_PAYABLE'
               );
          }
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

               // Queue BOOKING_CANCELLED. The status change committed above (it had to,
               // to claim the booking), so this is enqueued on its own — durable and
               // retried by the relay, rather than lost if Kafka is down. A mass
               // schedule cancellation is exactly when the user MUST be told.
               const { userInfo } = await fetchBookingEnrichment(booking);
               await prisma.$transaction(async (tx) => {
                    await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CANCELLED, booking.id, {
                         bookingId: booking.id,
                         userId: booking.userId,
                         email: userInfo.email,
                         firstName: userInfo.firstName,
                         scheduleId: booking.scheduleId,
                         reason: 'schedule_cancelled',
                         refundAmount: booking.status === 'CONFIRMED' ? booking.totalAmount : 0,
                         cancelledAt: new Date().toISOString(),
                    });
               });

               logger.info(`Booking ${booking.id} cancelled due to schedule cancellation`);
          } catch (error) {
               logger.error(`Failed to cancel booking ${booking.id} during schedule cancellation`, {
                    error: error.message,
               });
          }
     }
};

// ─── Stuck Booking Recovery ──────────────────────────────────────────────────
// CONFIRMING and CANCELLING are transient states with no timeout. If the process
// dies mid-saga the booking used to sit in one of them forever: the expiry job only
// scans PENDING/SEATS_HELD/PAYMENT_PENDING, and cancelBooking treats CONFIRMING as
// terminal and refuses to touch it. The seats stay locked, the payment stays
// captured, and no ticket is ever issued.
//
// The SagaLog has always recorded exactly what we need to finish the job. This reads
// it and resumes. Re-driving forward is safe because the inventory mutations are now
// idempotent (see inventoryClient — every call carries a stable key).

// A retried saga step writes a NEW log row, so a booking can have several rows for
// the same step. Only the most recent one describes the current state — an older
// COMPLETED row sitting behind a newer COMPENSATED one must not read as "still held".
const hasCompletedStep = async (bookingId, step) => {
     const log = await prisma.sagaLog.findFirst({
          where: { bookingId, step, status: { in: ['COMPLETED', 'COMPENSATED'] } },
          orderBy: { createdAt: 'desc' },
     });
     return log?.status === 'COMPLETED';
};

const recoverConfirming = async (booking, seatIds) => {
     // Was the inventory confirm already applied?
     let seatsConfirmed = await hasCompletedStep(booking.id, 'CONFIRM_SEATS');

     if (!seatsConfirmed) {
          // Unknown — the process may have died mid-call. Re-drive it; the operation is
          // idempotent, so this either applies it or replays the original result.
          try {
               await saga.executeConfirmSeats(booking, seatIds, booking.fromSeq, booking.toSeq);
               seatsConfirmed = true;
          } catch (error) {
               logger.error(`Recovery: could not confirm seats for stuck booking ${booking.id}`, {
                    error: error.message,
               });
          }
     }

     if (seatsConfirmed) {
          const { userInfo, fromStationName, toStationName } =
               await fetchBookingEnrichment(booking, { withStations: true });

          const finished = await prisma.$transaction(async (tx) => {
               const result = await tx.booking.updateMany({
                    where: { id: booking.id, status: 'CONFIRMING' },
                    data: { status: 'CONFIRMED', version: { increment: 1 } },
               });

               if (result.count === 0) return false; // someone else finished it first

               await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CONFIRMED, booking.id, {
                    bookingId: booking.id,
                    userId: booking.userId,
                    email: userInfo.email,
                    firstName: userInfo.firstName,
                    scheduleId: booking.scheduleId,
                    trainNumber: booking.trainNumber,
                    trainName: booking.trainName,
                    fromStationName,
                    toStationName,
                    departureDate: booking.departureDate,
                    seats: booking.seats.map(s => ({
                         seatNumber: s.seatNumber,
                         seatType: s.seatType,
                         price: s.price,
                    })),
                    totalAmount: booking.totalAmount,
                    confirmedAt: new Date().toISOString(),
               });

               return true;
          });

          if (!finished) return;

          await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

          logger.info(`Recovered stuck CONFIRMING booking ${booking.id} → CONFIRMED`);
          return;
     }

     // Could not confirm — roll the whole saga back, refunding the captured payment.
     await saga.compensateAll(booking, seatIds);

     const { userInfo } = await fetchBookingEnrichment(booking);

     await prisma.$transaction(async (tx) => {
          const result = await tx.booking.updateMany({
               where: { id: booking.id, status: 'CONFIRMING' },
               data: {
                    status: 'FAILED',
                    failureReason: 'stuck_confirming_recovered',
                    version: { increment: 1 },
               },
          });

          if (result.count === 0) return;

          await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_FAILED, booking.id, {
               bookingId: booking.id,
               userId: booking.userId,
               email: userInfo.email,
               firstName: userInfo.firstName,
               scheduleId: booking.scheduleId,
               reason: 'confirm_seats_failed',
               failedAt: new Date().toISOString(),
          });
     });

     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

     logger.warn(`Recovered stuck CONFIRMING booking ${booking.id} → FAILED (compensated)`);
};

const recoverCancelling = async (booking, seatIds) => {
     // The saga log tells us whether the seats were ever actually booked, which decides
     // whether this is a cancel-a-confirmed-booking or a release-a-hold.
     const wasConfirmed = await hasCompletedStep(booking.id, 'CONFIRM_SEATS');
     let refundInitiated = false;

     try {
          if (wasConfirmed) {
               await inventoryClient.cancelBooking(booking.scheduleId, booking.id, booking.userId);

               if (booking.paymentOrderId) {
                    try {
                         await paymentClient.initiateRefund(
                              booking.paymentOrderId,
                              booking.totalAmount,
                              'user_cancelled',
                              `${booking.id}-cancel-refund`
                         );
                         refundInitiated = true;
                    } catch (error) {
                         logger.error(`Recovery: refund failed for stuck booking ${booking.id}`, {
                              error: extractPaymentError(error).message,
                         });
                    }
               }
          } else {
               await inventoryClient.releaseSeats(
                    booking.scheduleId, seatIds, booking.userId, booking.fromSeq, booking.toSeq, booking.id
               );
          }
     } catch (error) {
          // Leave it CANCELLING so the next sweep retries rather than reporting a
          // cancellation whose seats are still held.
          logger.error(`Recovery: could not release inventory for stuck booking ${booking.id} — will retry`, {
               error: error.message,
          });
          return;
     }

     const { userInfo } = await fetchBookingEnrichment(booking);

     const finished = await prisma.$transaction(async (tx) => {
          const result = await tx.booking.updateMany({
               where: { id: booking.id, status: 'CANCELLING' },
               data: { status: 'CANCELLED', version: { increment: 1 } },
          });

          if (result.count === 0) return false;

          await enqueueBookingEvent(tx, KAFKA_TOPICS.BOOKING_CANCELLED, booking.id, {
               bookingId: booking.id,
               userId: booking.userId,
               email: userInfo.email,
               firstName: userInfo.firstName,
               scheduleId: booking.scheduleId,
               reason: 'user_cancelled',
               refundAmount: refundInitiated ? booking.totalAmount : 0,
               cancelledAt: new Date().toISOString(),
          });

          return true;
     });

     if (!finished) return;

     await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

     logger.info(`Recovered stuck CANCELLING booking ${booking.id} → CANCELLED`);
};

/**
 * Resume a booking abandoned in a transient state.
 * Safe to call repeatedly: every terminal write is status-guarded, so a booking
 * another process already finished is left alone.
 */
const recoverStuckBooking = async (booking) => {
     const seatIds = booking.seats.map(s => s.seatId).sort();

     logger.warn(`Recovering booking ${booking.id} stuck in ${booking.status}`, {
          stuckSinceMs: Date.now() - new Date(booking.updatedAt).getTime(),
     });

     if (booking.status === 'CONFIRMING') return recoverConfirming(booking, seatIds);
     if (booking.status === 'CANCELLING') return recoverCancelling(booking, seatIds);
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
     recoverStuckBooking,
};
