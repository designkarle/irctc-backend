import { SEAT_TYPES, SEAT_TYPE_LABELS } from '../../utils/constants';

export default function SeatFilters({ activeFilter, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <button
        onClick={() => onChange(null)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          !activeFilter ? 'bg-primary-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        All
      </button>
      {SEAT_TYPES.map((type) => (
        <button
          key={type}
          onClick={() => onChange(type)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeFilter === type ? 'bg-primary-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {SEAT_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}
