import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { isCollapsibleMemo } from '../lib/memoDisplay';

interface RecordMemoProps {
  memo: string;
}

/**
 * 記録カードの備考。
 *
 * 長い備考（テイスティングノートを書き足したものなど）は2行で切り、
 * クリックで全文に広がる。一覧の見通しを保ちながら、その場で中身を読めるようにする。
 *
 * カード全体は `layout` 付きの motion.div なので、開閉に合わせて高さが動く
 */
export function RecordMemo({ memo }: RecordMemoProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isCollapsibleMemo(memo)) {
    return (
      <p
        className="mt-2 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400"
        data-testid="record-memo"
      >
        {memo}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsExpanded((prev) => !prev)}
      aria-expanded={isExpanded}
      className="mt-2 w-full rounded-lg px-1 py-1 text-left transition-colors hover:bg-gray-500/5"
      data-testid="record-memo-toggle"
      title={isExpanded ? 'クリックで折りたたむ' : 'クリックで全文を表示'}
    >
      <p
        className={`text-xs text-gray-600 dark:text-gray-400 ${
          isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
        }`}
        data-testid="record-memo"
      >
        {memo}
      </p>
      <span className="mt-0.5 flex items-center gap-0.5 text-[11px] text-gray-500 dark:text-gray-500">
        {isExpanded ? '折りたたむ' : 'もっと見る'}
        <ChevronDown className={`size-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </span>
    </button>
  );
}
