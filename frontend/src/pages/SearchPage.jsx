import SearchForm from '../components/search/SearchForm';
import TrainList from '../components/search/TrainList';
import Spinner from '../components/ui/Spinner';
import { useSearchStore } from '../store/search.store';

export default function SearchPage() {
  const { results, isSearching } = useSearchStore();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Search Trains</h1>

      <div className="card mb-8">
        <SearchForm />
      </div>

      {isSearching ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : results ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {results.count || results.trains?.length || 0} train{(results.count || results.trains?.length) !== 1 ? 's' : ''} found
              {results.from?.resolved && ` from ${results.from.resolved}`}
              {results.to?.resolved && ` to ${results.to.resolved}`}
              {results.date && results.date !== 'any' && ` on ${results.date}`}
            </p>
          </div>
          <TrainList trains={results.trains} />
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">Search for trains to see results</p>
        </div>
      )}
    </div>
  );
}
