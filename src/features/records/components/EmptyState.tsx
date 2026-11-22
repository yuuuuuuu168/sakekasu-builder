interface EmptyStateProps {
  hasActiveFilter: boolean;
}

export function EmptyState({ hasActiveFilter }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-base font-medium text-ink-2">
        {hasActiveFilter
          ? '条件に一致する記録がありません'
          : '記録がありません'}
      </p>
      {!hasActiveFilter && (
        <p className="mt-2 text-sm text-muted-foreground">
          上の「購入登録」「飲酒登録」から記録を追加できます
        </p>
      )}
    </div>
  );
}
