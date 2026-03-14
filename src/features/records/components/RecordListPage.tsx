import { ThemeToggle } from '@/components/ThemeToggle';
import { useRecordList } from '../hooks/useRecordList';
import { FilterControls } from './FilterControls';
import { RecordCard } from './RecordCard';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';

export function RecordListPage() {
  const {
    records,
    isLoading,
    error,
    recordType,
    category,
    sortOption,
    searchQuery,
    hasActiveFilter,
    setRecordType,
    setCategory,
    setSortOption,
    setSearchQuery,
    resetFilters,
    refetch,
  } = useRecordList();

  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-indigo-wa dark:text-dark-gold sm:text-2xl">
            🍶 記録一覧
          </h1>
          <ThemeToggle />
        </header>

        {/* フィルタ・ソートコントロール */}
        <div className="mb-6">
          <FilterControls
            recordType={recordType}
            category={category}
            searchQuery={searchQuery}
            sortOption={sortOption}
            hasActiveFilter={hasActiveFilter}
            onRecordTypeChange={setRecordType}
            onCategoryChange={setCategory}
            onSearchQueryChange={setSearchQuery}
            onSortChange={setSortOption}
            onReset={resetFilters}
          />
        </div>

        {/* コンテンツ */}
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : records.length === 0 ? (
          <EmptyState hasActiveFilter={hasActiveFilter} />
        ) : (
          <div className="space-y-4">
            {records.map((record) => (
              <RecordCard key={record.id} record={record} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
