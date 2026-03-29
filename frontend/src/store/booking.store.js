import { create } from 'zustand';
import { MAX_SEATS_PER_BOOKING } from '../utils/constants';

export const useBookingStore = create((set, get) => ({
  selectedTrain: null,
  scheduleId: null,
  fromStation: null,  // --- SEGMENT BOOKING: { stationId, name, code, sequenceNumber }
  toStation: null,    // --- SEGMENT BOOKING: { stationId, name, code, sequenceNumber }
  selectedSeats: new Map(),
  passengers: [],

  // --- SEGMENT BOOKING: Store from/to station data when selecting a train ---
  setSelectedTrain: (train, scheduleId) => set({
    selectedTrain: train,
    scheduleId,
    fromStation: train.from ? { stationId: train.from.stationId, name: train.from.name, code: train.from.code, sequenceNumber: train.from.sequenceNumber } : null,
    toStation: train.to ? { stationId: train.to.stationId, name: train.to.name, code: train.to.code, sequenceNumber: train.to.sequenceNumber } : null,
    selectedSeats: new Map(),
    passengers: [],
  }),

  toggleSeat: (seat) => {
    const current = new Map(get().selectedSeats);
    if (current.has(seat.seatId)) {
      current.delete(seat.seatId);
    } else {
      if (current.size >= MAX_SEATS_PER_BOOKING) return false;
      current.set(seat.seatId, seat);
    }
    set({ selectedSeats: current });
    return true;
  },

  setPassengers: (passengers) => set({ passengers }),

  get totalPrice() {
    let total = 0;
    get().selectedSeats.forEach((s) => (total += s.price || 0));
    return total;
  },

  reset: () => set({ selectedTrain: null, scheduleId: null, fromStation: null, toStation: null, selectedSeats: new Map(), passengers: [] }), // --- SEGMENT BOOKING: reset from/to station
}));
