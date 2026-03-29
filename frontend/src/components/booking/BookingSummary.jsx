import { formatCurrency, formatSeatType, formatDate } from '../../utils/format';

export default function BookingSummary({ train, seats, totalPrice, departureDate }) {
  return (
    <div className="card mb-6">
      <h3 className="text-lg font-semibold mb-3">Booking Summary</h3>
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="font-bold text-primary-900">{train?.trainName}</p>
          <p className="text-sm text-gray-500">#{train?.trainNumber}</p>
        </div>
        {departureDate && (
          <p className="text-sm text-gray-600">Departure: <strong>{formatDate(departureDate)}</strong></p>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 text-gray-500 font-medium">Seat #</th>
            <th className="py-2 text-gray-500 font-medium">Type</th>
            <th className="py-2 text-gray-500 font-medium text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {seats.map((s) => (
            <tr key={s.seatId} className="border-b border-gray-50">
              <td className="py-2">{s.seatNumber}</td>
              <td className="py-2">{formatSeatType(s.seatType)}</td>
              <td className="py-2 text-right">{formatCurrency(s.price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="py-3 text-right font-bold">Total</td>
            <td className="py-3 text-right font-bold text-primary-900 text-lg">{formatCurrency(totalPrice)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
