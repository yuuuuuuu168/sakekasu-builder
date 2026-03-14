export function LoadingState() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-white/20 bg-white/80 p-4 shadow-sm backdrop-blur-lg dark:bg-white/5"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="mb-2 h-5 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-3">
            <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}
