import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { linkifyText } from '../lib/linkify';
import { ChatMessageList } from '../components/ChatMessageList';
import type { ChatMessage } from '../types';

function renderText(text: string) {
  render(<div>{linkifyText(text)}</div>);
}

function link(name: string) {
  return screen.getByRole('link', { name });
}

describe('linkifyText', () => {
  it('URL をリンクにする', () => {
    renderText('詳しくは https://example.com/sake を見てください');

    const anchor = link('https://example.com/sake');
    expect(anchor.getAttribute('href')).toBe('https://example.com/sake');
    // 出典は外部サイトなので、開き元を渡さず別タブで開く
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('URL の前後の文章は残す', () => {
    const { container } = render(<div>{linkifyText('出典: https://example.com/a です')}</div>);

    expect(container.textContent).toBe('出典: https://example.com/a です');
  });

  it('複数の URL をそれぞれリンクにする', () => {
    renderText('https://example.com/a と https://example.com/b');

    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('閉じ括弧や句点はリンクに含めない', () => {
    const { container } = render(
      <div>{linkifyText('（https://example.com/a）と https://example.com/b。')}</div>,
    );

    expect(link('https://example.com/a').getAttribute('href')).toBe('https://example.com/a');
    expect(link('https://example.com/b').getAttribute('href')).toBe('https://example.com/b');
    expect(container.textContent).toBe('（https://example.com/a）と https://example.com/b。');
  });

  it('http と https 以外はリンクにしない', () => {
    // 出典として開ける先は Web だけでよい。javascript: を書かれても素通しにしない
    renderText('javascript:alert(1) と ftp://example.com/a と mailto:a@example.com');

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('URL が無ければそのまま返す', () => {
    expect(linkifyText('今夜は燗酒がおすすめです')).toBe('今夜は燗酒がおすすめです');
    expect(linkifyText('')).toBe('');
  });
});

describe('ChatMessageList の描画', () => {
  function message(role: ChatMessage['role'], content: string): ChatMessage {
    return { id: `${role}-1`, role, content };
  }

  it('ソムリエの回答の URL はリンクになる', () => {
    render(<ChatMessageList messages={[message('assistant', '出典 https://example.com/a')]} />);

    expect(link('https://example.com/a').getAttribute('href')).toBe('https://example.com/a');
  });

  it('ユーザーの発言はリンクにしない', () => {
    render(<ChatMessageList messages={[message('user', 'https://example.com/a はどう？')]} />);

    expect(screen.queryByRole('link')).toBeNull();
  });
});
