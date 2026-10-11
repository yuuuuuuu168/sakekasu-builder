// 共通ポータルの目印 `?sso=1` を読んで URL から消す処理の確認。

import { describe, it, expect, vi } from 'vitest';

import { consumeSsoHint, parseSsoHint } from '../ssoHint';

const ORIGIN = 'https://sake.sakekasu-builder.com';

describe('parseSsoHint', () => {
  it('sso=1 を目印として読み、取り除いた URL を返す', () => {
    expect(parseSsoHint(`${ORIGIN}/?sso=1`)).toEqual({
      present: true,
      oauthCallback: false,
      cleanedUrl: '/',
    });
  });

  it('パス・他のクエリ・ハッシュは残す', () => {
    const hint = parseSsoHint(`${ORIGIN}/records?a=1&sso=1&b=x%20y#top`);
    expect(hint.present).toBe(true);
    expect(hint.cleanedUrl).toBe('/records?a=1&b=x+y#top');
  });

  it('sso が無ければ書き換え不要（cleanedUrl は null）', () => {
    expect(parseSsoHint(`${ORIGIN}/?a=1#h`)).toEqual({
      present: false,
      oauthCallback: false,
      cleanedUrl: null,
    });
  });

  it('sso=1 以外の値は目印にしないが、URL からは取り除く', () => {
    expect(parseSsoHint(`${ORIGIN}/?sso=0`)).toEqual({
      present: false,
      oauthCallback: false,
      cleanedUrl: '/',
    });
  });

  it('code や error が付いていればマネージドログインからの戻りとみなす', () => {
    expect(parseSsoHint(`${ORIGIN}/?code=abc&state=xyz`).oauthCallback).toBe(true);
    expect(parseSsoHint(`${ORIGIN}/?error=access_denied`).oauthCallback).toBe(true);
  });
});

describe('consumeSsoHint', () => {
  function fakeHistory() {
    return { state: { k: 1 }, replaceState: vi.fn() };
  }

  it('目印があれば URL を履歴を増やさずに書き換え、true を返す', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/?sso=1#x` }, history)).toBe(true);
    expect(history.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/#x');
  });

  it('目印が無ければ URL に触らず false を返す', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/` }, history)).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('戻りの最中なら目印を消すだけで false を返す', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/?sso=1&code=abc&state=s` }, history)).toBe(false);
    expect(history.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/?code=abc&state=s');
  });
});
