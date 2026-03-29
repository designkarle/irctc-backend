import { useEffect } from 'react';
import { useAuthStore } from './store/auth.store';
import AppRouter from './router';

export default function App() {
  const fetchProfile = useAuthStore((s) => s.fetchProfile);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return <AppRouter />;
}
