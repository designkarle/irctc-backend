const { BadRequestError, ConflictError, NotFoundError } = require('../utils/error');
const adminProducer = require('../kafka/producer/admin.producer');
const logger = require('../config/logger');
const prisma = require('../config/prisma');

const createSchedule = async (data) => {
     const { trainId, departureDate } = data;
     const train = await prisma.train.findUnique({
          where: { id: trainId },
          include: {
               seats: { orderBy: { seatNumber: 'asc' } },
               route: {
                    include: {
                         routeStations: {
                              include: { station: true },
                              orderBy: { sequenceNumber: 'asc' },
                         },
                    },
               },
          },
     });

     if (!train) throw new NotFoundError('Train not found');
     if (!train.route) throw new BadRequestError('Train has no route defined. Create a route first.');
     if (train.seats.length === 0) throw new BadRequestError('Train has no seats defined.');

     const parsedDate = new Date(departureDate);
     if (isNaN(parsedDate.getTime())) {
          throw new BadRequestError('Invalid departure date format. Use YYYY-MM-DD');
     }

     // Check for duplicate schedule
     const existing = await prisma.schedule.findUnique({
          where: { trainId_departureDate: { trainId, departureDate: parsedDate } },
     });
     if (existing) throw new ConflictError('Schedule already exists for this train on this date');

     const schedule = await prisma.schedule.create({
          data: { trainId, departureDate: parsedDate },
     });

     // Build a rich event payload with everything consumers need
     const eventPayload = {
          scheduleId: schedule.id,
          trainId: train.id,
          trainNumber: train.trainNumber,
          trainName: train.trainName,
          coachName: train.coachName,
          totalSeats: train.totalSeats,
          departureDate: departureDate,
          status: schedule.status,
          seats: train.seats.map((s) => ({
               seatId: s.id,
               seatNumber: s.seatNumber,
               seatType: s.seatType,
               price: s.price,
          })),
          route: train.route.routeStations.map((rs) => ({
               stationId: rs.station.id,
               stationName: rs.station.name,
               stationCode: rs.station.code,
               city: rs.station.city,
               sequenceNumber: rs.sequenceNumber,
               arrivalTime: rs.arrivalTime,
               departureTime: rs.departureTime,
               distanceFromOrigin: rs.distanceFromOrigin,
          })),
     };

     // This event goes to both inventory-service and search-service via Kafka
     await adminProducer.publishScheduleCreated(eventPayload);
     logger.info(`Schedule created and event published for train ${train.trainNumber} on ${departureDate}`);

     return schedule;
}


const getAllSchedules = async (query = {}) => {
     const where = {};
     if (query.trainId) where.trainId = query.trainId;
     if (query.status) where.status = query.status;
     if (query.date) where.departureDate = new Date(query.date);

     return prisma.schedule.findMany({
          where,
          include: {
               train: {
                    include: {
                         route: {
                              include: {
                                   routeStations: {
                                        include: { station: true },
                                        orderBy: { sequenceNumber: 'asc' },
                                   },
                              },
                         },
                    },
               },
          },
          orderBy: { departureDate: 'asc' },
     });
};


const cancelSchedule = async (scheduleId) => {
     const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
     if (!schedule) throw new NotFoundError('Schedule not found');

     const updated = await prisma.schedule.update({
          where: { id: scheduleId },
          data: { status: 'CANCELLED' },
     });

     await adminProducer.publishScheduleCancelled(updated);
     return updated;
};

module.exports = { createSchedule, getAllSchedules, cancelSchedule };