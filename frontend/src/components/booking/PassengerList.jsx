import PassengerForm from './PassengerForm';

export default function PassengerList({ seats, register, errors }) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Passenger Details</h3>
      {seats.map((seat, i) => (
        <PassengerForm key={seat.seatId} index={i} seat={seat} register={register} errors={errors} />
      ))}
    </div>
  );
}
