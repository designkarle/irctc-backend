import { useState, useEffect, useRef, useCallback } from 'react';
import { bookingApi } from '../api/booking.api';

const TERMINAL_STATUSES = ['CONFIRMED', 'CANCELLED', 'FAILED', 'EXPIRED'];
const POLL_INTERVAL = 3000;
const MAX_POLLS = 20;

export function useBookingPolling(bookingId) {
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollCount = useRef(0);
  const intervalRef = useRef(null);

  const fetchBooking = useCallback(async () => {
    try {
      const res = await bookingApi.getById(bookingId);
      const data = res.data || res;
      setBooking(data);
      setLoading(false);

      if (TERMINAL_STATUSES.includes(data.status)) {
        clearInterval(intervalRef.current);
        return;
      }

      pollCount.current += 1;
      if (pollCount.current >= MAX_POLLS) {
        clearInterval(intervalRef.current);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
      clearInterval(intervalRef.current);
    }
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId) return;
    pollCount.current = 0;
    setLoading(true);
    fetchBooking();

    intervalRef.current = setInterval(fetchBooking, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [bookingId, fetchBooking]);

  const refresh = () => fetchBooking();

  return { booking, loading, error, refresh };
}
