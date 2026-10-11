// 自動サインインの印（sessionStorage）の扱い。

import { describe, it, expect, beforeEach } from 'vitest';

import {
  AUTO_SIGN_IN_MARK_KEY,
  canAutoSignIn,
  clearAutoSignInMark,
  hasAutoSignInMark,
  markAutoSignIn,
} from '../autoSignIn';

/** どの操作でも例外を投げるストレージ（ストレージを塞いだブラウザ） */
const brokenStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('自動サインインの印', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('印を置くと、このタブではもう自動で送らない', () => {
    expect(canAutoSignIn({ oauthCallback: false })).toBe(true);
    expect(markAutoSignIn()).toBe(true);
    expect(window.sessionStorage.getItem(AUTO_SIGN_IN_MARK_KEY)).not.toBeNull();
    expect(hasAutoSignInMark()).toBe(true);
    expect(canAutoSignIn({ oauthCallback: false })).toBe(false);
  });

  it('印を消すと、また一度だけ自動で送る', () => {
    markAutoSignIn();
    clearAutoSignInMark();
    expect(hasAutoSignInMark()).toBe(false);
    expect(canAutoSignIn({ oauthCallback: false })).toBe(true);
  });

  it('戻りの最中は印が無くても送らない', () => {
    expect(canAutoSignIn({ oauthCallback: true })).toBe(false);
  });

  it('ストレージが使えないときは、一度だけを守れないので送らない', () => {
    expect(markAutoSignIn(brokenStorage)).toBe(false);
    expect(hasAutoSignInMark(brokenStorage)).toBe(true);
    expect(canAutoSignIn({ oauthCallback: false }, brokenStorage)).toBe(false);
    expect(() => clearAutoSignInMark(brokenStorage)).not.toThrow();
    expect(markAutoSignIn(null)).toBe(false);
    expect(canAutoSignIn({ oauthCallback: false }, null)).toBe(false);
  });
});
