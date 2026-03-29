import { Routes, Route } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import SearchPage from '../pages/SearchPage';
import SeatSelectionPage from '../pages/SeatSelectionPage';
import BookingPage from '../pages/BookingPage';
import BookingDetailPage from '../pages/BookingDetailPage';
import MyBookingsPage from '../pages/MyBookingsPage';
import AdminPage from '../pages/AdminPage';
import NotFoundPage from '../pages/NotFoundPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/search" element={<SearchPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/seats/:scheduleId" element={<SeatSelectionPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/bookings" element={<MyBookingsPage />} />
          <Route path="/bookings/:bookingId" element={<BookingDetailPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
