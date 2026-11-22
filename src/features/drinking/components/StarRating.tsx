import { useState } from 'react';
import { Star } from 'lucide-react';
import { motion } from 'framer-motion';

export interface StarRatingProps {
  value: number;           // 現在の評価値（0=未選択、1〜5）
  onChange: (rating: number) => void;
  maxStars?: number;       // デフォルト5
}

export function StarRating({ value, onChange, maxStars = 5 }: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState(0);

  const displayValue = hoverValue > 0 ? hoverValue : value;

  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => setHoverValue(0)}
      data-testid="star-rating"
    >
      {Array.from({ length: maxStars }, (_, i) => {
        const starIndex = i + 1;
        const isFilled = starIndex <= displayValue;

        return (
          <motion.button
            key={starIndex}
            type="button"
            role="button"
            aria-label={`${starIndex}/${maxStars}`}
            data-testid={`star-${i}`}
            className={`cursor-pointer rounded-sm p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isFilled
                ? 'text-gold-ink'
                : 'text-border'
            }`}
            onClick={() => onChange(starIndex)}
            onMouseEnter={() => setHoverValue(starIndex)}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            <Star
              className="size-6"
              fill={isFilled ? 'currentColor' : 'none'}
              strokeWidth={1.5}
            />
          </motion.button>
        );
      })}
      <span
        className="ml-1.5 text-sm text-muted-foreground tabular-nums"
        data-testid="rating-text"
      >
        {value}/{maxStars}
      </span>
    </div>
  );
}
