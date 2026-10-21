import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResponse } from '../llm.js';
import { pickSingleToolInput } from '../toolInput.js';

/** 指定したブロックを持つ応答を作る */
function responseWith(content: ToolResponse['content']): ToolResponse {
  return { content, stopReason: 'tool_use', provider: 'anthropic', model: 'claude-haiku-5-5' };
}

describe('pickSingleToolInput', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('指定した tool の tool_use がちょうど 1 つなら、その input を返す', () => {
    const response = responseWith([
      { type: 'text' },
      { type: 'tool_use', name: 'other_tool', input: { a: 2 } },
      { type: 'tool_use', name: 'record', input: { a: 1 } },
    ]);

    expect(pickSingleToolInput(response, 'record', '[Test]')).toEqual({ a: 1 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('input が無ければ null を返す', () => {
    const response = responseWith([{ type: 'tool_use', name: 'record' }]);

    expect(pickSingleToolInput(response, 'record', '[Test]')).toBeNull();
  });

  // max_tokens 到達などで欠けた場合と、インジェクションの疑いがある複数の場合
  it.each([
    ['無い', []],
    [
      '2 つある',
      [
        { type: 'tool_use', name: 'record', input: { a: 1 } },
        { type: 'tool_use', name: 'record', input: { a: 2 } },
      ],
    ],
  ])('指定した tool の tool_use が%s場合は、どれも採らずに null を返して警告を残す', (_, content) => {
    const response = { ...responseWith(content), stopReason: 'max_tokens' };

    expect(pickSingleToolInput(response, 'record', '[Test]')).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[Test] unexpected tool_use block count:',
      JSON.stringify({ count: content.length, stopReason: 'max_tokens', provider: 'anthropic' }),
    );
  });
});
