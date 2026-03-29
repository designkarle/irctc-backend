import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin.api';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { formatDate } from '../../utils/format';

export default function ScheduleManager() {
  const [trains, setTrains] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [selectedTrain, setSelectedTrain] = useState('');
  const [date, setDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    adminApi.getTrains().then((res) => setTrains(res.data || [])).catch(() => {});
    fetchSchedules();
  }, []);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getSchedules();
      setSchedules(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!selectedTrain || !date) { showToast('Select train and date', 'warning'); return; }
    setCreating(true);
    try {
      await adminApi.createSchedule({ trainId: selectedTrain, departureDate: date });
      showToast('Schedule created!', 'success');
      setSelectedTrain('');
      setDate('');
      fetchSchedules();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (id) => {
    try {
      await adminApi.cancelSchedule(id);
      showToast('Schedule cancelled', 'success');
      fetchSchedules();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div>
      <form onSubmit={handleCreate} className="card mb-6">
        <h3 className="font-semibold mb-4">Create Schedule</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Train</label>
            <select value={selectedTrain} onChange={(e) => setSelectedTrain(e.target.value)} className="input-field" required>
              <option value="">Select train</option>
              {trains.map((t) => <option key={t.id} value={t.id}>{t.trainNumber} — {t.trainName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Departure Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={today} className="input-field" required />
          </div>
          <Button type="submit" loading={creating}>Create Schedule</Button>
        </div>
      </form>

      <div className="card">
        <h3 className="font-semibold mb-4">Schedules</h3>
        {loading ? <p className="text-center py-4 text-gray-400">Loading...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Train</th>
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{s.train?.trainNumber || s.trainId} — {s.train?.trainName || ''}</td>
                    <td className="py-2">{formatDate(s.departureDate)}</td>
                    <td className="py-2"><Badge status={s.status} /></td>
                    <td className="py-2 text-right">
                      {s.status === 'ACTIVE' && (
                        <Button variant="danger" onClick={() => handleCancel(s.id)} className="text-xs py-1 px-2">Cancel</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
