// 開いた URL の読み取り。共通ポータルの目印 `?sso=1` を消し、戻りの最中かどうかを見る。

import { describe, it, expect, vi } from 'vitest';

import { consumeSsoHint, parseSsoHint } from '../ssoHint';

const ORIGIN = 'https://sake.sakekasu-builder.com';

describe('parseSsoHint', () => {
  it('sso=1 を目印として読み、取り除いた URL を返す', () => {
    expect(parseSsoHint(`${ORIGIN}/?sso=1`)).toEqual({
      present: true,
      oauthCallback: false,
      oauthError: false,
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
      oauthError: false,
      cleanedUrl: null,
    });
  });

  it('sso=1 以外の値は目印にしないが、URL からは取り除く', () => {
    expect(parseSsoHint(`${ORIGIN}/?sso=0`)).toEqual({
      present: false,
      oauthCallback: false,
      oauthError: false,
      cleanedUrl: '/',
    });
  });

  it('code や error が付いていればマネージドログインからの戻りとみなす', () => {
    expect(parseSsoHint(`${ORIGIN}/?code=abc&state=xyz`)).toMatchObject({
      oauthCallback: true,
      oauthError: false,
    });
    expect(parseSsoHint(`${ORIGIN}/?error=access_denied`)).toMatchObject({
      oauthCallback: true,
      oauthError: true,
    });
  });
});

describe('consumeSsoHint', () => {
  function fakeHistory() {
    return { state: { k: 1 }, replaceState: vi.fn() };
  }

  it('目印があれば URL を履歴を増やさずに書き換える', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/?sso=1#x` }, history)).toEqual({
      oauthCallback: false,
      oauthError: false,
    });
    expect(history.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/#x');
  });

  it('目印が無ければ URL に触らない', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/` }, history)).toEqual({
      oauthCallback: false,
      oauthError: false,
    });
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('戻りの最中なら目印を消し、戻りの最中だと返す', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/?sso=1&code=abc&state=s` }, history)).toEqual({
      oauthCallback: true,
      oauthError: false,
    });
    expect(history.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/?code=abc&state=s');
  });

  it('error は Amplify が読み直すので URL に残す', () => {
    const history = fakeHistory();
    expect(consumeSsoHint({ href: `${ORIGIN}/?error=access_denied` }, history)).toEqual({
      oauthCallback: true,
      oauthError: true,
    });
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
