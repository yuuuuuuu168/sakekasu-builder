import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

const MotionButton = motion.create(Button);

interface SubmitButtonProps {
  isSubmitting: boolean;
  isEditMode: boolean;
  /**
   * 送信中に出す文言。画像のアップロード中など、保存の手前の段階を見せたいときに渡す。
   * 渡さなければ「登録中...」「更新中...」
   */
  busyLabel?: string | null;
}

/** 購入・飲酒フォームの登録（更新）ボタン */
export function SubmitButton({ isSubmitting, isEditMode, busyLabel }: SubmitButtonProps) {
  return (
    <MotionButton
      type="submit"
      data-testid="submit-button"
      disabled={isSubmitting}
      className="w-full h-10 text-base font-semibold"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {isSubmitting ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {busyLabel ?? (isEditMode ? '更新中...' : '登録中...')}
        </>
      ) : isEditMode ? (
        '🍶 更新する'
      ) : (
        '🍶 登録する'
      )}
    </MotionButton>
  );
}
