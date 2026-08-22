/**
 * 記録カードの備考表示のテスト。
 *
 * テイスティングノートを書き足した備考は複数行になるので、一覧では
 * 2行で切り、クリックで全文に広げる。短い備考は折りたたまない。
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordMemo } from '../components/RecordMemo';
import { isCollapsibleMemo } from '../lib/memoDisplay';

const LONG_MEMO =
  'テイスティングノート: バニラと蜂蜜の甘い香り。余韻は長く、かすかにスモーキー\nおすすめの飲み方: ストレートかトワイスアップで香りを開かせるのがおすすめ';

describe('isCollapsibleMemo', () => {
  it('改行を含む備考は折りたたむ', () => {
    expect(isCollapsibleMemo('一行目\n二行目')).toBe(true);
  });

  it('長い備考は折りたたむ', () => {
    expect(isCollapsibleMemo('あ'.repeat(41))).toBe(true);
  });

  it('短い1行の備考は折りたたまない', () => {
    expect(isCollapsibleMemo('美味しかった')).toBe(false);
  });
});

describe('RecordMemo', () => {
  it('短い備考はそのまま全文を出す（開閉ボタンは出さない）', () => {
    render(<RecordMemo memo="美味しかった" />);

    expect(screen.getByTestId('record-memo')).toHaveTextContent('美味しかった');
    expect(screen.queryByTestId('record-memo-toggle')).not.toBeInTheDocument();
  });

  it('長い備考は最初2行で切る', () => {
    render(<RecordMemo memo={LONG_MEMO} />);

    expect(screen.getByTestId('record-memo')).toHaveClass('line-clamp-2');
    expect(screen.getByTestId('record-memo-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('もっと見る')).toBeInTheDocument();
  });

  it('クリックすると全文が広がり、もう一度クリックで戻る', () => {
    render(<RecordMemo memo={LONG_MEMO} />);
    const toggle = screen.getByTestId('record-memo-toggle');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('record-memo')).not.toHaveClass('line-clamp-2');
    expect(screen.getByText('折りたたむ')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('record-memo')).toHaveClass('line-clamp-2');
  });

  // 切っているのは表示だけで、中身は最初から持っている
  it('折りたたんでいても本文は欠けていない', () => {
    render(<RecordMemo memo={LONG_MEMO} />);

    expect(screen.getByTestId('record-memo')).toHaveTextContent('おすすめの飲み方');
  });
});
