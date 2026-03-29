import { create } from 'zustand';

export const useSearchStore = create((set) => ({
  from: '',
  to: '',
  date: '',
  results: null,
  isSearching: false,

  setSearchParams: (from, to, date) => set({ from, to, date }),
  setResults: (results) => set({ results, isSearching: false }),
  setSearching: (v) => set({ isSearching: v }),
  clearResults: () => set({ results: null }),
}));
