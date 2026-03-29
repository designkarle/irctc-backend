import { useState, useEffect } from 'react';
import { adminApi } from '../../api/admin.api';
import { useToast } from '../ui/Toast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Pagination from '../ui/Pagination';

export default function StationManager() {
  const [stations, setStations] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', city: '', state: '' });
  const [creating, setCreating] = useState(false);
  const showToast = useToast();

  const fetchStations = async (page = 1) => {
    setLoading(true);
    try {
      const res = await adminApi.getStations(page, 20, search);
      setStations(res.data || []);
      setPagination(res.pagination || { page: 1, totalPages: 1 });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStations(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await adminApi.createStation(form);
      showToast('Station created!', 'success');
      setForm({ name: '', code: '', city: '', state: '' });
      fetchStations();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchStations(1);
  };

  return (
    <div>
      <form onSubmit={handleCreate} className="card mb-6">
        <h3 className="font-semibold mb-4">Create Station</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={10} />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
          <Input label="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required />
        </div>
        <Button type="submit" loading={creating} className="mt-4">Create Station</Button>
      </form>

      <div className="card">
        <div className="flex items-center justify-between mb-4 gap-3">
          <h3 className="font-semibold">Stations</h3>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="input-field max-w-[200px]" />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
        </div>

        {loading ? (
          <p className="text-center py-8 text-gray-400">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-left">Code</th>
                  <th className="py-2 text-left">City</th>
                  <th className="py-2 text-left">State</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{s.name}</td>
                    <td className="py-2 font-mono">{s.code}</td>
                    <td className="py-2">{s.city}</td>
                    <td className="py-2">{s.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={fetchStations} />
      </div>
    </div>
  );
}
