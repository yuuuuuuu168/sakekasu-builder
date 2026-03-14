import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="mb-4 text-5xl" role="img" aria-label="エラー">
        ⚠️
      </span>
      <p className="text-lg font-medium text-gray-600 dark:text-gray-400">
        {message}
      </p>
      <Button
        variant="outline"
        size="lg"
        className="mt-4"
        onClick={onRetry}
      >
        再取得
      </Button>
    </div>
  );
}
