import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { toSpecDisplayEntries } from '@/features/specs/lib/sakeSpecs';
import type { SakeSpecs } from '@/features/specs/types';

interface RecordSpecsProps {
  specs: SakeSpecs | undefined;
}

/**
 * 記録カードの詳細スペック（Issue #87）。
 *
 * 値のある項目だけを、クリックで開く一覧にまとめる。カードに常時展開すると、
 * 精米歩合まで埋めた記録が一覧を占領して他の記録が見えなくなる。
 *
 * カード全体は `layout` 付きの motion.div なので、開閉に合わせて高さが動く
 */
export function RecordSpecs({ specs }: RecordSpecsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const entries = toSpecDisplayEntries(specs);

  if (entries.length === 0) {
    return null;
  }

  // 紹介文は1行に収まらないので、他の項目とは分けて下に置く
  const description = entries.find((entry) => entry.key === 'labelDescription');
  const rows = entries.filter((entry) => entry.key !== 'labelDescription');

  return (
    <div className="mt-2" data-testid="record-specs">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-500/5 dark:text-gray-400"
        data-testid="record-specs-toggle"
      >
        📋 詳細スペック {entries.length}件
        <ChevronDown className={`size-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <dl
          className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-gray-500/5 px-2.5 py-2 text-xs"
          data-testid="record-specs-list"
        >
          {rows.map((entry) => (
            <div key={entry.key} className="contents">
              <dt className="text-gray-500 dark:text-gray-400">{entry.label}</dt>
              <dd
                className="font-medium text-gray-700 dark:text-gray-300"
                data-testid={`record-spec-${entry.key}`}
              >
                {entry.value}
              </dd>
            </div>
          ))}
          {description && (
            <div className="col-span-2 border-t border-gray-500/10 pt-1.5">
              <dt className="text-gray-500 dark:text-gray-400">{description.label}</dt>
              <dd
                className="mt-0.5 whitespace-pre-wrap text-gray-700 dark:text-gray-300"
                data-testid="record-spec-labelDescription"
              >
                {description.value}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
