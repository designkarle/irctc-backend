import { useNavigate } from 'react-router-dom';
import { useBookingStore } from '../../store/booking.store';
import { useAuthStore } from '../../store/auth.store';
import { formatSeatType } from '../../utils/format';
import Button from '../ui/Button';

export default function TrainCard({ train }) {
  const navigate = useNavigate();
  const setSelectedTrain = useBookingStore((s) => s.setSelectedTrain);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const schedule = train.schedule;
  const seatSummary = train.seatSummary || {};

  const handleCheckAvailability = () => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(`/seats/${schedule.scheduleId}`)}`);
      return;
    }
    setSelectedTrain(train, schedule.scheduleId);
    navigate(`/seats/${schedule.scheduleId}`);
  };

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Train Info */}
        <div className="flex-1">
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className="text-lg font-bold text-primary-900">{train.trainName}</h3>
            <span className="text-sm text-gray-400">#{train.trainNumber}</span>
          </div>

          {/* Departure / Arrival */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <p className="font-semibold text-lg">{train.from?.departure || '—'}</p>
              <p className="text-gray-500">{train.from?.name}</p>
            </div>
            <div className="flex-1 flex items-center px-2">
              <div className="h-px bg-gray-300 flex-1" />
              <span className="px-2 text-gray-400 text-xs">→</span>
              <div className="h-px bg-gray-300 flex-1" />
            </div>
            <div className="text-right">
              <p className="font-semibold text-lg">{train.to?.arrival || '—'}</p>
              <p className="text-gray-500">{train.to?.name}</p>
            </div>
          </div>
        </div>

        {/* Seat Summary + Action */}
        <div className="sm:text-right sm:min-w-[200px]">
          {/* Seat type counts */}
          <div className="flex flex-wrap gap-2 mb-3 sm:justify-end">
            {Object.entries(seatSummary).filter(([k]) => k !== 'total').map(([type, count]) => (
              count > 0 && (
                <span key={type} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                  {formatSeatType(type)}: {count}
                </span>
              )
            ))}
          </div>

          {schedule && schedule.status !== 'CANCELLED' ? (
            <Button onClick={handleCheckAvailability} variant="accent" className="text-sm">
              Check Availability
            </Button>
          ) : (
            <span className="text-sm text-gray-400">
              {schedule?.status === 'CANCELLED' ? 'Cancelled' : 'No schedule available'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
