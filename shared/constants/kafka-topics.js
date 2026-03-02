/**
 * Centralized Kafka topic definitions.
 * Every service imports from here so topic names stay in sync.
 */
const KAFKA_TOPICS = {
     // Notification topics (user-service -> notification-service)
     OTP_EMAIL: 'notification.otp-email',
     WELCOME_EMAIL: 'notification.welcome-email',
     BOOKING_EMAIL: 'notification.booking-email',
     PAYMENT_EMAIL: 'notification.payment-email',

     // Admin topics (admin-service -> inventory/search)
     TRAIN_CREATED: 'admin.train-created',
     STATION_CREATED: 'admin.station-created',
     ROUTE_CREATED: 'admin.route-created',
     SCHEDULE_CREATED: 'admin.schedule-created',
     TRAIN_UPDATED: 'admin.train-updated',
     STATION_UPDATED: 'admin.station-updated',
     ROUTE_UPDATED: 'admin.route-updated',
     SCHEDULE_UPDATED: 'admin.schedule-updated',

     // Inventory topics (inventory-service -> search-service)
     SEAT_AVAILABILITY_UPDATED: 'inventory.seat-availability-updated',

     // Booking topics (booking-service -> notification-service)
     BOOKING_CONFIRMED: 'booking.confirmed',
     BOOKING_CANCELLED: 'booking.cancelled',
     BOOKING_FAILED: 'booking.failed',

     // Payment topics (payment-service -> booking-service)
     PAYMENT_SUCCESS: 'payment.success',
     PAYMENT_FAILED: 'payment.failed',
};

module.exports = { KAFKA_TOPICS };