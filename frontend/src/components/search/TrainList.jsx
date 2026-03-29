import TrainCard from './TrainCard';
import EmptyState from '../ui/EmptyState';

export default function TrainList({ trains }) {
  if (!trains || trains.length === 0) {
    return <EmptyState title="No trains found" message="Try different stations or date" />;
  }

  return (
    <div className="space-y-4">
      {trains.map((train, i) => (
        <TrainCard key={train.trainId || i} train={train} />
      ))}
    </div>
  );
}
