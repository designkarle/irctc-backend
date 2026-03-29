const TABS = ['Stations', 'Trains', 'Routes', 'Schedules'];

export default function AdminTabs({ active, onChange }) {
  return (
    <div className="flex border-b mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
            active === tab
              ? 'border-primary-900 text-primary-900'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
