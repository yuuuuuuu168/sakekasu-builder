import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-base font-medium text-ink-2" role="alert">
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
