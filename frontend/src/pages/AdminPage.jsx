import { useState } from 'react';
import AdminTabs from '../components/admin/AdminTabs';
import StationManager from '../components/admin/StationManager';
import TrainManager from '../components/admin/TrainManager';
import RouteManager from '../components/admin/RouteManager';
import ScheduleManager from '../components/admin/ScheduleManager';

export default function AdminPage() {
  const [tab, setTab] = useState('Stations');

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <AdminTabs active={tab} onChange={setTab} />

      {tab === 'Stations' && <StationManager />}
      {tab === 'Trains' && <TrainManager />}
      {tab === 'Routes' && <RouteManager />}
      {tab === 'Schedules' && <ScheduleManager />}
    </div>
  );
}
