import { formatDate } from '../../utils/format';

export default function AvailabilitySummary({ availability, train }) {
  if (!availability) return null;

  return (
    <div className="card mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-primary-900">{train?.trainName || availability.trainName}</h2>
          <p className="text-gray-500 text-sm">#{train?.trainNumber || availability.trainNumber}</p>
          {train?.from && (
            <p className="text-sm text-gray-600 mt-1">
              {train.from.name} → {train.to.name}
            </p>
          )}
        </div>
        <div className="flex gap-6 text-center">
          <div>
            <p className="text-2xl font-bold text-green-600">{availability.available}</p>
            <p className="text-xs text-gray-500">Available</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-600">{availability.locked}</p>
            <p className="text-xs text-gray-500">Locked</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-500">{availability.booked}</p>
            <p className="text-xs text-gray-500">Booked</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-600">{availability.totalSeats}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-500 mt-3">
        Departure: <strong>{formatDate(availability.departureDate)}</strong>
      </p>
    </div>
  );
}
