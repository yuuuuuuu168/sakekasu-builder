export function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-border bg-card p-4 shadow-sm" /* check-ui-ignore: 取得中だけ出すスケルトン */
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
          </div>
          <div className="mb-2 h-5 w-3/4 rounded bg-muted" />
          <div className="flex gap-3">
            <div className="h-4 w-20 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
