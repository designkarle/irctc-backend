import Spinner from '../ui/Spinner';

const PROCESSING_STATUSES = ['PENDING', 'SEATS_HELD', 'PAYMENT_PENDING', 'CONFIRMING'];

export default function BookingStatusPoller({ status }) {
  if (!PROCESSING_STATUSES.includes(status)) return null;

  const messages = {
    PENDING: 'Creating your booking...',
    SEATS_HELD: 'Seats reserved, awaiting payment...',
    PAYMENT_PENDING: 'Waiting for payment confirmation...',
    CONFIRMING: 'Payment received, confirming your booking...',
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
      <Spinner size="sm" />
      <div>
        <p className="text-sm font-semibold text-blue-800">{messages[status] || 'Processing...'}</p>
        <p className="text-xs text-blue-600 mt-0.5">This page will update automatically</p>
      </div>
    </div>
  );
}
