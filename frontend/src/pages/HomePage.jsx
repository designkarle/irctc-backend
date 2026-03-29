import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SearchForm from '../components/search/SearchForm';
import BookingCard from '../components/bookings/BookingCard';
import { useAuthStore } from '../store/auth.store';
import { bookingApi } from '../api/booking.api';

export default function HomePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [recentBookings, setRecentBookings] = useState([]);

  useEffect(() => {
    if (isAuthenticated) {
      bookingApi.list(null, 1, 3).then((res) => {
        const data = res.data || res;
        setRecentBookings(data.bookings || []);
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  return (
    <div>
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 text-white py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">Book Train Tickets</h1>
          <p className="text-primary-200 text-lg mb-8">Search, compare and book — the smarter way to travel by rail</p>

          <div className="bg-white rounded-xl p-6 shadow-xl">
            <SearchForm />
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="card text-center">
            <div className="text-3xl mb-3">🔍</div>
            <h3 className="font-semibold mb-1">Smart Search</h3>
            <p className="text-sm text-gray-500">Find trains with fuzzy station name matching</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-3">💺</div>
            <h3 className="font-semibold mb-1">Live Availability</h3>
            <p className="text-sm text-gray-500">Real-time seat availability and selection</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-3">🔒</div>
            <h3 className="font-semibold mb-1">Secure Payment</h3>
            <p className="text-sm text-gray-500">Powered by Razorpay with instant confirmation</p>
          </div>
        </div>

        {/* Recent Bookings */}
        {isAuthenticated && recentBookings.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Recent Bookings</h2>
              <Link to="/bookings" className="text-sm text-primary-700 hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {recentBookings.map((b) => <BookingCard key={b.id} booking={b} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
