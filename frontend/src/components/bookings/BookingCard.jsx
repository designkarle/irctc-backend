import { Link } from 'react-router-dom';
import Badge from '../ui/Badge';
import { formatDate, formatCurrency } from '../../utils/format';

export default function BookingCard({ booking }) {
  return (
    <Link to={`/bookings/${booking.id}`} className="card block hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-semibold text-primary-900">{booking.trainName}</h3>
            <Badge status={booking.status} />
          </div>
          <p className="text-sm text-gray-500">
            #{booking.trainNumber} &middot; {formatDate(booking.departureDate)} &middot; {booking.seatCount} seat{booking.seatCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold text-lg text-primary-900">{formatCurrency(booking.totalAmount)}</p>
          <p className="text-xs text-gray-400">{formatDate(booking.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}
