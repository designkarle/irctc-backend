import SeatTile from './SeatTile';

export default function SeatGrid({ seats, selectedSeats, onToggleSeat }) {
  if (!seats || seats.length === 0) {
    return <p className="text-center text-gray-500 py-8">No seats available</p>;
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
      {seats.map((seat) => (
        <SeatTile
          key={seat.seatId || seat.id}
          seat={seat}
          isSelected={selectedSeats.has(seat.seatId)}
          onToggle={onToggleSeat}
        />
      ))}
    </div>
  );
}
