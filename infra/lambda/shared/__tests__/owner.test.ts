import { describe, it, expect } from 'vitest';
import { assertOwnedKey, isOwnedKey, requireOwnerSub } from '../owner';

const SUB = '11111111-2222-3333-4444-555555555555';

describe('requireOwnerSub', () => {
  it('identity の sub を返す', () => {
    expect(requireOwnerSub({ identity: { sub: SUB } })).toBe(SUB);
  });

  it.each([
    ['identity が無い', {}],
    ['identity が null', { identity: null }],
    ['sub が無い', { identity: {} }],
    ['sub が空文字', { identity: { sub: '' } }],
  ])('%s なら認可エラーにする', (_label, event) => {
    expect(() => requireOwnerSub(event)).toThrow('Unauthorized: missing identity');
  });
});

describe('isOwnedKey', () => {
  it('自分の sub で始まるキーは自分のもの', () => {
    expect(isOwnedKey(SUB, `${SUB}/purchase/r1/a.jpg`)).toBe(true);
  });

  it('他人の sub で始まるキーは自分のものではない', () => {
    expect(isOwnedKey(SUB, 'other-sub/purchase/r1/a.jpg')).toBe(false);
  });

  // 区切りの / まで見ないと、sub が前方一致するだけの別人のキーを通してしまう
  it('sub の後ろに区切りが無ければ自分のものではない', () => {
    expect(isOwnedKey(SUB, `${SUB}x/purchase/r1/a.jpg`)).toBe(false);
  });

  it('sub が空なら / で始まるキーも誰のものとも見なさない', () => {
    expect(isOwnedKey('', '/purchase/r1/a.jpg')).toBe(false);
  });
});

describe('assertOwnedKey', () => {
  it('自分のキーなら何もしない', () => {
    expect(() => assertOwnedKey(SUB, `${SUB}/drinking/r1/a.jpg`)).not.toThrow();
  });

  it('他人のキーなら既定の文言で認可エラーにする', () => {
    expect(() => assertOwnedKey(SUB, 'other/drinking/r1/a.jpg')).toThrow(
      "Unauthorized: cannot access other user's images",
    );
  });

  it('文言を差し替えられる', () => {
    expect(() =>
      assertOwnedKey(SUB, 'other/drinking/r1/a.jpg', "Unauthorized: cannot copy other user's images"),
    ).toThrow("Unauthorized: cannot copy other user's images");
  });
});
