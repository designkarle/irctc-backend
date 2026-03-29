import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin.api';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import Input from '../ui/Input';

export default function RouteManager() {
  const [trains, setTrains] = useState([]);
  const [stations, setStations] = useState([]);
  const [selectedTrain, setSelectedTrain] = useState('');
  const [creating, setCreating] = useState(false);
  const [stops, setStops] = useState([{ stationId: '', sequenceNumber: 1, arrivalTime: '', departureTime: '', distanceFromOrigin: 0 }]);
  const showToast = useToast();

  useEffect(() => {
    adminApi.getTrains().then((res) => setTrains(res.data || [])).catch(() => {});
    adminApi.getStations(1, 100).then((res) => setStations(res.data || [])).catch(() => {});
  }, []);

  const addStop = () => {
    setStops([...stops, { stationId: '', sequenceNumber: stops.length + 1, arrivalTime: '', departureTime: '', distanceFromOrigin: 0 }]);
  };

  const removeStop = (i) => setStops(stops.filter((_, idx) => idx !== i));

  const updateStop = (i, field, value) => {
    const updated = [...stops];
    updated[i] = { ...updated[i], [field]: value };
    setStops(updated);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!selectedTrain) { showToast('Select a train', 'warning'); return; }
    setCreating(true);
    try {
      const stationsPayload = stops.map((s) => ({
        stationId: s.stationId,
        sequenceNumber: parseInt(s.sequenceNumber, 10),
        arrivalTime: s.arrivalTime || null,
        departureTime: s.departureTime || null,
        distanceFromOrigin: parseInt(s.distanceFromOrigin, 10) || 0,
      }));
      await adminApi.createRoute({ trainId: selectedTrain, stations: stationsPayload });
      showToast('Route created!', 'success');
      setSelectedTrain('');
      setStops([{ stationId: '', sequenceNumber: 1, arrivalTime: '', departureTime: '', distanceFromOrigin: 0 }]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} className="card">
      <h3 className="font-semibold mb-4">Create Route</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Train</label>
        <select value={selectedTrain} onChange={(e) => setSelectedTrain(e.target.value)} className="input-field max-w-sm" required>
          <option value="">Select a train</option>
          {trains.map((t) => <option key={t.id} value={t.id}>{t.trainNumber} — {t.trainName}</option>)}
        </select>
      </div>

      <h4 className="text-sm font-medium mb-2">Stops</h4>
      <div className="space-y-3 mb-4">
        {stops.map((stop, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-end bg-gray-50 rounded-lg p-3">
            <div className="w-10 text-center text-sm font-bold text-gray-400">{i + 1}</div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-gray-500 mb-1">Station</label>
              <select value={stop.stationId} onChange={(e) => updateStop(i, 'stationId', e.target.value)} className="input-field" required>
                <option value="">Select</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <Input label="Arrival" type="time" value={stop.arrivalTime} onChange={(e) => updateStop(i, 'arrivalTime', e.target.value)} className="w-32" />
            <Input label="Departure" type="time" value={stop.departureTime} onChange={(e) => updateStop(i, 'departureTime', e.target.value)} className="w-32" />
            <Input label="Distance (km)" type="number" value={stop.distanceFromOrigin} onChange={(e) => updateStop(i, 'distanceFromOrigin', e.target.value)} className="w-28" />
            {stops.length > 1 && (
              <button type="button" onClick={() => removeStop(i)} className="text-red-500 hover:text-red-700 text-xl pb-1">&times;</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={addStop}>+ Add Stop</Button>
        <Button type="submit" loading={creating}>Create Route</Button>
      </div>
    </form>
  );
}
