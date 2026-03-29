import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useBookingStore } from '../../store/booking.store';
import { bookingApi } from '../../api/booking.api';
import { loadRazorpayScript, openRazorpayCheckout } from '../../utils/razorpay';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';

export default function PaymentButton({ passengers, scheduleId, seatIds, disabled }) {
  const [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const reset = useBookingStore((s) => s.reset);
  const fromStation = useBookingStore((s) => s.fromStation);  // --- SEGMENT BOOKING
  const toStation = useBookingStore((s) => s.toStation);      // --- SEGMENT BOOKING
  const navigate = useNavigate();
  const showToast = useToast();

  const handlePay = async () => {
    setLoading(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      // --- SEGMENT BOOKING: Include fromStation/toStation segment params ---
      const res = await bookingApi.create({
        scheduleId, seatIds, passengers, idempotencyKey,
        fromStationId: fromStation?.stationId,
        toStationId: toStation?.stationId,
        fromSeq: fromStation?.sequenceNumber,
        toSeq: toStation?.sequenceNumber,
      });
      const booking = res.data || res;
      const paymentOrder = booking.paymentOrder;

      if (!paymentOrder?.gatewayOrderId) {
        showToast('Booking created but payment order missing', 'warning');
        navigate(`/bookings/${booking.bookingId}`);
        return;
      }

      await loadRazorpayScript();

      openRazorpayCheckout({
        keyId: paymentOrder.keyId,
        orderId: paymentOrder.gatewayOrderId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency || 'INR',
        bookingDescription: `Booking ${booking.bookingId}`,
        user,
        onSuccess: async (response) => {
          try {
            await bookingApi.verifyPayment(booking.bookingId, {
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            showToast('Payment verified! Confirming booking...', 'success');
          } catch (err) {
            showToast('Payment received. Confirmation may take a moment.', 'warning');
          }
          reset();
          navigate(`/bookings/${booking.bookingId}`);
        },
        onDismiss: () => {
          showToast('Payment cancelled. Your seats are held temporarily.', 'warning');
          reset();
          navigate(`/bookings/${booking.bookingId}`);
        },
        onFailure: (response) => {
          showToast('Payment failed: ' + (response?.error?.description || 'Unknown error'), 'error');
          reset();
          navigate(`/bookings/${booking.bookingId}`);
        },
      });
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Booking failed';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handlePay} loading={loading} disabled={disabled} className="w-full text-base py-3">
      Confirm & Pay
    </Button>
  );
}
