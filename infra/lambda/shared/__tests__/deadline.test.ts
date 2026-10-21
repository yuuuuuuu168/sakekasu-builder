import { afterEach, describe, expect, it, vi } from 'vitest';
import { deadlineFrom } from '../deadline.js';

describe('deadlineFrom', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('残り時間から、返す分を残した締め切りを決める', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);

    expect(deadlineFrom({ getRemainingTimeInMillis: () => 25_000 })).toBe(1_024_000);
    expect(deadlineFrom({ getRemainingTimeInMillis: () => 25_000 }, 3_000)).toBe(1_022_000);
  });

  it('context が無ければ締め切りを付けない', () => {
    expect(deadlineFrom(undefined)).toBeUndefined();
  });
});
