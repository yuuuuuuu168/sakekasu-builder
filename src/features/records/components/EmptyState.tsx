interface EmptyStateProps {
  hasActiveFilter: boolean;
}

export function EmptyState({ hasActiveFilter }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="mb-4 text-5xl" role="img" aria-label="お酒">
        🍶
      </span>
      <p className="text-lg font-medium text-gray-600 dark:text-gray-400">
        {hasActiveFilter
          ? '条件に一致する記録がありません'
          : '記録がありません'}
      </p>
      {!hasActiveFilter && (
        <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
          購入や飲酒の記録を登録してみましょう
        </p>
      )}
    </div>
  );
}
