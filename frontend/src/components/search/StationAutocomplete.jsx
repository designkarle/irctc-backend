import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { searchApi } from '../../api/search.api';

export default function StationAutocomplete({ label, value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchApi.autocomplete(debouncedQuery).then((res) => {
      if (!cancelled) {
        setSuggestions(res.data || []);
        setOpen(true);
      }
    }).catch(() => {
      if (!cancelled) setSuggestions([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync external value changes
  useEffect(() => {
    if (value !== undefined && value !== query) setQuery(value);
  }, [value]);

  const handleSelect = (station) => {
    setQuery(`${station.name} (${station.code})`);
    onChange(station.code, station.name);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.length < 2) onChange('', '');
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="input-field"
      />
      {loading && (
        <div className="absolute right-3 top-[38px]">
          <div className="animate-spin h-4 w-4 border-b-2 border-primary-900 rounded-full" />
        </div>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((s) => (
            <li
              key={s.stationId || s.code}
              onClick={() => handleSelect(s)}
              className="px-4 py-2.5 hover:bg-primary-50 cursor-pointer text-sm flex justify-between"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-gray-400 text-xs">{s.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
