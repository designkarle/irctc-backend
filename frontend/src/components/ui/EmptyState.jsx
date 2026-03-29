export default function EmptyState({ title = 'No results found', message, children }) {
  return (
    <div className="text-center py-16">
      <div className="text-5xl mb-4 text-gray-300">📭</div>
      <h3 className="text-lg font-semibold text-gray-700">{title}</h3>
      {message && <p className="text-sm text-gray-500 mt-1">{message}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
