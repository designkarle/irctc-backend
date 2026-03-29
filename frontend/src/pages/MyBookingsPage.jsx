import { useState, useEffect } from 'react';
import { bookingApi } from '../api/booking.api';
import BookingCard from '../components/bookings/BookingCard';
import BookingFilters from '../components/bookings/BookingFilters';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  const fetchBookings = async (status, page) => {
    setLoading(true);
    try {
      const res = await bookingApi.list(status || undefined, page, 10);
      const data = res.data || res;
      setBookings(data.bookings || []);
      setPagination(data.pagination || { page: 1, totalPages: 1 });
    } catch (err) {
      showToast(err.message || 'Failed to load bookings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings(statusFilter, 1);
  }, [statusFilter]);

  const handlePageChange = (page) => {
    fetchBookings(statusFilter, page);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">My Bookings</h1>

      <BookingFilters active={statusFilter} onChange={(v) => setStatusFilter(v)} />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : bookings.length === 0 ? (
        <EmptyState title="No bookings found" message={statusFilter ? 'Try a different filter' : 'Book your first train ticket!'} />
      ) : (
        <>
          <div className="space-y-3">
            {bookings.map((b) => <BookingCard key={b.id} booking={b} />)}
          </div>
          <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={handlePageChange} />
        </>
      )}
    </div>
  );
}
