import { useNavigate } from 'react-router-dom';
import { useBookingStore } from '../../store/booking.store';
import { formatCurrency } from '../../utils/format';
import { MAX_SEATS_PER_BOOKING } from '../../utils/constants';
import Button from '../ui/Button';

export default function SelectionSummary() {
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const navigate = useNavigate();

  const count = selectedSeats.size;
  let totalPrice = 0;
  selectedSeats.forEach((s) => (totalPrice += s.price || 0));

  if (count === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-30">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold">{count}</span> seat{count !== 1 ? 's' : ''} selected
          <span className="text-gray-400 ml-1">(max {MAX_SEATS_PER_BOOKING})</span>
          <span className="ml-4 font-bold text-primary-900 text-lg">{formatCurrency(totalPrice)}</span>
        </div>
        <Button onClick={() => navigate('/booking')}>
          Proceed to Booking
        </Button>
      </div>
    </div>
  );
}
