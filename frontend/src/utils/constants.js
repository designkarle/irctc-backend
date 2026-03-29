export const SEAT_TYPES = ['LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER'];

export const SEAT_TYPE_LABELS = {
  LOWER: 'Lower',
  MIDDLE: 'Middle',
  UPPER: 'Upper',
  SIDE_LOWER: 'Side Lower',
  SIDE_UPPER: 'Side Upper',
};

export const SEAT_STATUS_COLORS = {
  AVAILABLE: 'bg-green-500',
  LOCKED: 'bg-yellow-500',
  BOOKED: 'bg-red-400',
  SELECTED: 'bg-blue-500',
};

export const BOOKING_STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  SEATS_HELD: 'bg-yellow-100 text-yellow-800',
  PAYMENT_PENDING: 'bg-orange-100 text-orange-800',
  CONFIRMING: 'bg-blue-100 text-blue-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLING: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

export const MAX_SEATS_PER_BOOKING = 6;
