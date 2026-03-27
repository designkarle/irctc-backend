const asyncHandler = require('../utils/asyncHandler');
const { BadRequestError } = require('../utils/error');
const inventoryService = require('../services/inventory.service');

exports.getScheduleAvailability = asyncHandler(async (req, res) => {
     const { scheduleId } = req.params;

     const data = await inventoryService.getAvailability(scheduleId);

     res.status(200).json({ success: true, data });
});

exports.getScheduleSeats = asyncHandler(async (req, res) => {
     const { scheduleId } = req.params;
     const { status, seatType, fromSeq, toSeq } = req.query; // --- SEGMENT BOOKING: added fromSeq/toSeq

     const filters = {};
     if (status) filters.status = status.toUpperCase();
     if (seatType) filters.seatType = seatType.toUpperCase();
     if (fromSeq) filters.fromSeq = fromSeq; // --- SEGMENT BOOKING
     if (toSeq) filters.toSeq = toSeq;       // --- SEGMENT BOOKING

     const data = await inventoryService.getSeats(scheduleId, filters);

     res.status(200).json({ success: true, data });
});

exports.lockSeats = asyncHandler(async (req, res) => {
     const { scheduleId, seatIds, ttlSeconds, userId, fromSeq, toSeq } = req.body; // --- SEGMENT BOOKING: added fromSeq/toSeq

     if (!scheduleId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
          throw new BadRequestError('scheduleId and seatIds (non-empty array) are required');
     }

     if (!userId) {
          throw new BadRequestError('userId is required');
     }

     const result = await inventoryService.lockSeats(scheduleId, seatIds, userId, ttlSeconds, fromSeq, toSeq); // --- SEGMENT BOOKING

     res.status(200).json({
          success: true,
          message: `${result.lockedSeats.length} seat(s) locked successfully`,
          data: {
               scheduleId: result.scheduleId,
               lockedSeats: result.lockedSeats,
               lockExpiresAt: result.lockExpiresAt,
          },
     });
});

exports.unlockSeats = asyncHandler(async (req, res) => {
     const { scheduleId, seatIds, userId, fromSeq, toSeq } = req.body; // --- SEGMENT BOOKING: added fromSeq/toSeq

     if (!scheduleId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
          throw new BadRequestError('scheduleId and seatIds (non-empty array) are required');
     }

     if (!userId) {
          throw new BadRequestError('userId is required');
     }

     const result = await inventoryService.unlockSeats(scheduleId, seatIds, userId, fromSeq, toSeq); // --- SEGMENT BOOKING

     res.status(200).json({
          success: true,
          message: `${result.unlockedSeats.length} seat(s) unlocked successfully`,
          data: {
               scheduleId: result.scheduleId,
               unlockedSeats: result.unlockedSeats,
          },
     });
});

exports.confirmSeats = asyncHandler(async (req, res) => {
     const { scheduleId, seatIds, bookingId, userId, fromSeq, toSeq } = req.body; // --- SEGMENT BOOKING: added fromSeq/toSeq

     if (!scheduleId || !seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
          throw new BadRequestError('scheduleId, seatIds (non-empty array), and bookingId are required');
     }

     if (!bookingId) {
          throw new BadRequestError('bookingId is required');
     }

     if (!userId) {
          throw new BadRequestError('userId is required');
     }

     const result = await inventoryService.confirmSeats(scheduleId, seatIds, userId, bookingId, fromSeq, toSeq); // --- SEGMENT BOOKING

     res.status(200).json({
          success: true,
          message: `${result.confirmedSeats.length} seat(s) confirmed`,
          data: {
               scheduleId: result.scheduleId,
               bookingId: result.bookingId,
               confirmedSeats: result.confirmedSeats,
          },
     });
});

exports.cancelBooking = asyncHandler(async (req, res) => {
     const { scheduleId, bookingId, userId } = req.body;

     if (!scheduleId || !bookingId) {
          throw new BadRequestError('scheduleId and bookingId are required');
     }

     if (!userId) {
          throw new BadRequestError('userId is required');
     }

     const result = await inventoryService.cancelBooking(scheduleId, bookingId, userId);

     res.status(200).json({
          success: true,
          message: `Booking cancelled, ${result.releasedSeats.length} seat(s) released`,
          data: {
               scheduleId: result.scheduleId,
               bookingId: result.bookingId,
               releasedSeats: result.releasedSeats,
          },
     });
});
