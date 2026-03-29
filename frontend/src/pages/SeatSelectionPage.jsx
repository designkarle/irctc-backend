import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/inventory.api';
import { useBookingStore } from '../store/booking.store';
import { useToast } from '../components/ui/Toast';
import AvailabilitySummary from '../components/seats/AvailabilitySummary';
import SeatFilters from '../components/seats/SeatFilters';
import SeatGrid from '../components/seats/SeatGrid';
import SeatLegend from '../components/seats/SeatLegend';
import SelectionSummary from '../components/seats/SelectionSummary';
import Spinner from '../components/ui/Spinner';
import { MAX_SEATS_PER_BOOKING } from '../utils/constants';

export default function SeatSelectionPage() {
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const selectedTrain = useBookingStore((s) => s.selectedTrain);
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const toggleSeat = useBookingStore((s) => s.toggleSeat);
  const setSelectedTrain = useBookingStore((s) => s.setSelectedTrain);
  const fromStation = useBookingStore((s) => s.fromStation);  // --- SEGMENT BOOKING
  const toStation = useBookingStore((s) => s.toStation);      // --- SEGMENT BOOKING

  const [availability, setAvailability] = useState(null);
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // --- SEGMENT BOOKING: Pass segment params to getSeats for segment-aware availability ---
        const seatParams = {};
        if (fromStation?.sequenceNumber && toStation?.sequenceNumber) {
          seatParams.fromSeq = fromStation.sequenceNumber;
          seatParams.toSeq = toStation.sequenceNumber;
        }

        const [availRes, seatsRes] = await Promise.all([
          inventoryApi.getAvailability(scheduleId),
          inventoryApi.getSeats(scheduleId, seatParams),
        ]);
        const rawAvail = availRes.data || availRes;
        const seatList = (seatsRes.data?.seats || seatsRes.seats || []).sort((a, b) => a.seatNumber - b.seatNumber);
        setSeats(seatList);

        // --- SEGMENT BOOKING: Recompute availability counts from segment-aware seat data ---
        if (seatParams.fromSeq && seatParams.toSeq && seatList.some(s => s.segmentStatus)) {
          const segAvail = seatList.filter(s => s.segmentStatus === 'AVAILABLE').length;
          const segUnavail = seatList.filter(s => s.segmentStatus === 'UNAVAILABLE').length;
          setAvailability({
            ...rawAvail,
            available: segAvail,
            booked: segUnavail,
            locked: 0,
          });
        } else {
          setAvailability(rawAvail);
        }

        // If no selectedTrain in store, set from availability data
        if (!selectedTrain) {
          const avail = availRes.data || availRes;
          setSelectedTrain({
            trainName: avail.trainName,
            trainNumber: avail.trainNumber,
            trainId: avail.trainId,
          }, scheduleId);
        }
      } catch (err) {
        showToast(err.message || 'Failed to load seats', 'error');
        navigate('/search');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [scheduleId]);

  const handleToggleSeat = (seat) => {
    const result = toggleSeat(seat);
    if (result === false) {
      showToast(`Maximum ${MAX_SEATS_PER_BOOKING} seats can be selected`, 'warning');
    }
  };

  const filteredSeats = filter ? seats.filter((s) => s.seatType === filter) : seats;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 pb-24">
      <AvailabilitySummary availability={availability} train={selectedTrain} />

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <h3 className="text-lg font-semibold">Select Seats</h3>
          <SeatLegend />
        </div>

        <SeatFilters activeFilter={filter} onChange={setFilter} />
        <SeatGrid seats={filteredSeats} selectedSeats={selectedSeats} onToggleSeat={handleToggleSeat} />
      </div>

      <SelectionSummary />
    </div>
  );
}
