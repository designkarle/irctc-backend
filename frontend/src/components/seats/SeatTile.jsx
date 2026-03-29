import { formatSeatType, formatCurrency } from '../../utils/format';

const STATUS_STYLES = {
  AVAILABLE: 'bg-green-100 border-green-400 hover:bg-green-200 cursor-pointer',
  LOCKED: 'bg-yellow-100 border-yellow-400 cursor-not-allowed opacity-60',
  BOOKED: 'bg-red-100 border-red-300 cursor-not-allowed opacity-60',
  CANCELLED: 'bg-gray-100 border-gray-300 cursor-not-allowed opacity-40',
  SELECTED: 'bg-blue-500 border-blue-600 text-white cursor-pointer ring-2 ring-blue-300',
};

export default function SeatTile({ seat, isSelected, onToggle }) {
  // --- SEGMENT BOOKING: When segmentStatus is present, trust it as authoritative ---
  // segmentStatus comes from segment-overlap check; seat.status reflects overall seat_inventory state.
  // A seat can be BOOKED overall but AVAILABLE for a non-overlapping segment.
  const effectiveStatus = seat.segmentStatus
    ? (seat.segmentStatus === 'AVAILABLE' ? 'AVAILABLE' : 'BOOKED')
    : seat.status;
  const status = isSelected ? 'SELECTED' : effectiveStatus;
  const canSelect = effectiveStatus === 'AVAILABLE';

  return (
    <button
      onClick={() => canSelect && onToggle(seat)}
      disabled={!canSelect && !isSelected}
      className={`border-2 rounded-lg p-2 text-center transition-all min-w-[70px] ${STATUS_STYLES[status]}`}
      title={`Seat #${seat.seatNumber} - ${formatSeatType(seat.seatType)} - ${formatCurrency(seat.price)}`}
    >
      <p className={`text-sm font-bold ${isSelected ? 'text-white' : ''}`}>#{seat.seatNumber}</p>
      <p className={`text-[10px] ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>{formatSeatType(seat.seatType)}</p>
      <p className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-gray-700'}`}>{formatCurrency(seat.price)}</p>
    </button>
  );
}
