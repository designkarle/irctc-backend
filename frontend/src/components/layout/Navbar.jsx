import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-primary-900 text-white shadow-lg sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-wide">
            <span className="bg-white text-primary-900 rounded px-1.5 py-0.5 text-sm font-black">IR</span>
            <span>IRCTC</span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/search" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors">
              Search
            </Link>

            {isAuthenticated ? (
              <>
                <Link to="/bookings" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors">
                  My Bookings
                </Link>
                <Link to="/admin" className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary-800 transition-colors">
                  Admin
                </Link>
                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-primary-700">
                  <span className="text-sm hidden sm:inline text-primary-200">
                    {user?.firstName}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-800 hover:bg-primary-700 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <Link to="/login" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent-700 hover:bg-accent-600 transition-colors">
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
