import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin.api';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { SEAT_TYPES } from '../../utils/constants';

const seatTypeOptions = SEAT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }));

export default function TrainManager() {
  const [trains, setTrains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ trainNumber: '', trainName: '', coachName: '' });
  const [seatRows, setSeatRows] = useState([{ seatNumber: '', seatType: 'LOWER', price: '' }]);
  const showToast = useToast();

  const fetchTrains = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getTrains();
      setTrains(res.data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrains(); }, []);

  const addSeatRow = () => setSeatRows([...seatRows, { seatNumber: '', seatType: 'LOWER', price: '' }]);
  const removeSeatRow = (i) => setSeatRows(seatRows.filter((_, idx) => idx !== i));
  const updateSeatRow = (i, field, value) => {
    const updated = [...seatRows];
    updated[i] = { ...updated[i], [field]: value };
    setSeatRows(updated);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const seats = seatRows.map((r) => ({
        seatNumber: parseInt(r.seatNumber, 10),
        seatType: r.seatType,
        price: parseFloat(r.price),
      }));
      await adminApi.createTrain({ ...form, seats });
      showToast('Train created!', 'success');
      setForm({ trainNumber: '', trainName: '', coachName: '' });
      setSeatRows([{ seatNumber: '', seatType: 'LOWER', price: '' }]);
      fetchTrains();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleCreate} className="card mb-6">
        <h3 className="font-semibold mb-4">Create Train</h3>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Input label="Train Number" value={form.trainNumber} onChange={(e) => setForm({ ...form, trainNumber: e.target.value })} required />
          <Input label="Train Name" value={form.trainName} onChange={(e) => setForm({ ...form, trainName: e.target.value })} required />
          <Input label="Coach Name" value={form.coachName} onChange={(e) => setForm({ ...form, coachName: e.target.value })} required />
        </div>

        <h4 className="text-sm font-medium mb-2">Seats</h4>
        <div className="space-y-2 mb-4">
          {seatRows.map((row, i) => (
            <div key={i} className="flex gap-2 items-end">
              <Input label={i === 0 ? 'Seat #' : undefined} type="number" value={row.seatNumber} onChange={(e) => updateSeatRow(i, 'seatNumber', e.target.value)} placeholder="#" required className="w-24" />
              <Select label={i === 0 ? 'Type' : undefined} value={row.seatType} onChange={(e) => updateSeatRow(i, 'seatType', e.target.value)} options={seatTypeOptions} className="w-36" />
              <Input label={i === 0 ? 'Price' : undefined} type="number" value={row.price} onChange={(e) => updateSeatRow(i, 'price', e.target.value)} placeholder="Price" required className="w-28" />
              {seatRows.length > 1 && (
                <button type="button" onClick={() => removeSeatRow(i)} className="text-red-500 hover:text-red-700 text-xl pb-1">&times;</button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={addSeatRow}>+ Add Seat</Button>
          <Button type="submit" loading={creating}>Create Train</Button>
        </div>
      </form>

      <div className="card">
        <h3 className="font-semibold mb-4">Trains</h3>
        {loading ? <p className="text-center py-4 text-gray-400">Loading...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Number</th>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-left">Coach</th>
                  <th className="py-2 text-left">Seats</th>
                </tr>
              </thead>
              <tbody>
                {trains.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-mono">{t.trainNumber}</td>
                    <td className="py-2">{t.trainName}</td>
                    <td className="py-2">{t.coachName}</td>
                    <td className="py-2">{t.totalSeats || t.seats?.length || '—'}</td>
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
