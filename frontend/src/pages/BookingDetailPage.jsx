import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useBookingPolling } from '../hooks/useBookingPolling';
import { bookingApi } from '../api/booking.api';
import { useToast } from '../components/ui/Toast';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import BookingStatusPoller from '../components/booking/BookingStatusPoller';
import { formatDate, formatDateTime, formatCurrency, formatSeatType } from '../utils/format';

export default function BookingDetailPage() {
  const { bookingId } = useParams();
  const { booking, loading, error, refresh } = useBookingPolling(bookingId);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const showToast = useToast();

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await bookingApi.cancel(bookingId);
      showToast('Booking cancelled successfully', 'success');
      setShowCancel(false);
      refresh();
    } catch (err) {
      showToast(err.message || 'Failed to cancel', 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-red-50 text-red-700 rounded-lg p-6 text-center">
          <p className="font-semibold">Error loading booking</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!booking) return null;

  const canCancel = ['CONFIRMED', 'PAYMENT_PENDING', 'SEATS_HELD'].includes(booking.status);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Booking Details</h1>
        <Badge status={booking.status} />
      </div>

      <BookingStatusPoller status={booking.status} />

      {booking.status === 'CONFIRMED' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 mb-6">
          <span className="text-2xl">✓</span>
          <div>
            <p className="font-semibold text-green-800">Booking Confirmed!</p>
            <p className="text-sm text-green-700">Your tickets have been booked successfully</p>
          </div>
        </div>
      )}

      {booking.status === 'FAILED' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="font-semibold text-red-800">Booking Failed</p>
          {booking.failureReason && <p className="text-sm text-red-600 mt-1">{booking.failureReason}</p>}
        </div>
      )}

      {/* Train Info */}
      <div className="card mb-4">
        <h3 className="text-lg font-semibold text-primary-900 mb-1">{booking.trainName}</h3>
        <p className="text-sm text-gray-500 mb-3">#{booking.trainNumber} &middot; Departure: {formatDate(booking.departureDate)}</p>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Booking ID</p>
            <p className="font-mono text-xs">{booking.id}</p>
          </div>
          <div>
            <p className="text-gray-500">Booked on</p>
            <p>{formatDateTime(booking.createdAt)}</p>
          </div>
          <div>
            <p className="text-gray-500">Total Amount</p>
            <p className="font-bold text-primary-900">{formatCurrency(booking.totalAmount)}</p>
          </div>
          <div>
            <p className="text-gray-500">Seats</p>
            <p>{booking.seatCount}</p>
          </div>
        </div>
      </div>

      {/* Seats */}
      <div className="card mb-4">
        <h3 className="font-semibold mb-3">Seats</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left text-gray-500">Seat #</th>
              <th className="py-2 text-left text-gray-500">Type</th>
              <th className="py-2 text-right text-gray-500">Price</th>
            </tr>
          </thead>
          <tbody>
            {booking.seats?.map((s) => (
              <tr key={s.seatId} className="border-b border-gray-50">
                <td className="py-2">{s.seatNumber}</td>
                <td className="py-2">{formatSeatType(s.seatType)}</td>
                <td className="py-2 text-right">{formatCurrency(s.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Passengers */}
      {booking.passengers && booking.passengers.length > 0 && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Passengers</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left text-gray-500">#</th>
                <th className="py-2 text-left text-gray-500">Name</th>
                <th className="py-2 text-left text-gray-500">Age</th>
                <th className="py-2 text-left text-gray-500">Gender</th>
              </tr>
            </thead>
            <tbody>
              {booking.passengers.map((p, i) => (
                <tr key={p.id || i} className="border-b border-gray-50">
                  <td className="py-2">{i + 1}</td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.age}</td>
                  <td className="py-2">{p.gender}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCancel && (
        <Button variant="danger" onClick={() => setShowCancel(true)} className="w-full">
          Cancel Booking
        </Button>
      )}

      <Modal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        title="Cancel Booking?"
        confirmText="Yes, Cancel"
        onConfirm={handleCancel}
        loading={cancelling}
        danger
      >
        Are you sure you want to cancel this booking? This action cannot be undone.
        {booking.status === 'CONFIRMED' && ' A refund will be initiated.'}
      </Modal>
    </div>
  );
}
