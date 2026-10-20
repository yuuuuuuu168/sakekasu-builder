import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockGraphql } = vi.hoisted(() => ({ mockGraphql: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

import {
  imageFieldsForCreate,
  imageFieldsForUpdate,
  useRecordMutation,
} from '../recordMutation';

const OPTIONS = { logLabel: 'TestRecord create', failureMessage: '失敗しました' };

describe('useRecordMutation', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('input を variables に包んで送り、成功を返す', async () => {
    mockGraphql.mockResolvedValue({ data: { createTestRecord: { id: 'r1' } } });
    const { result } = renderHook(() => useRecordMutation());

    let res;
    await act(async () => {
      res = await result.current.run('mutation Q', { name: '獺祭' }, OPTIONS);
    });

    expect(res).toEqual({ success: true });
    expect(mockGraphql).toHaveBeenCalledWith({
      query: 'mutation Q',
      variables: { input: { name: '獺祭' } },
    });
  });

  it('errors が返ったら固定の文言で失敗を返し、ログに残す', async () => {
    mockGraphql.mockResolvedValue({ data: null, errors: [{ message: 'denied' }] });
    const { result } = renderHook(() => useRecordMutation());

    let res;
    await act(async () => {
      res = await result.current.run('mutation Q', {}, OPTIONS);
    });

    expect(res).toEqual({ success: false, error: '失敗しました' });
    expect(console.error).toHaveBeenCalledWith('TestRecord create errors:', [{ message: 'denied' }]);
  });

  it('例外でも固定の文言で失敗を返し、isSaving を戻す', async () => {
    let reject: (e: Error) => void = () => {};
    mockGraphql.mockImplementation(() => new Promise((_, r) => { reject = r; }));
    const { result } = renderHook(() => useRecordMutation());

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run('mutation Q', {}, OPTIONS);
    });
    expect(result.current.isSaving).toBe(true);

    let res;
    await act(async () => {
      reject(new Error('network'));
      res = await pending;
    });

    expect(res).toEqual({ success: false, error: '失敗しました' });
    expect(result.current.isSaving).toBe(false);
  });
});

describe('imageFieldsForCreate', () => {
  it('キーがあれば代表画像と一覧を載せる', () => {
    expect(imageFieldsForCreate({ imageKey: 'a', imageKeys: ['a', 'b'] })).toEqual({
      imageKey: 'a',
      imageKeys: ['a', 'b'],
    });
  });

  it('画像が無ければ代表画像は null、一覧は送らない', () => {
    expect(imageFieldsForCreate()).toEqual({ imageKey: null, imageKeys: undefined });
    expect(imageFieldsForCreate({ imageKeys: [] })).toEqual({ imageKey: null, imageKeys: undefined });
  });
});

describe('imageFieldsForUpdate', () => {
  it('画像を触らない更新では何も載せない（既存のキーを消さない）', () => {
    expect(imageFieldsForUpdate()).toEqual({});
    expect(imageFieldsForUpdate({ imageKey: 'a', imageKeys: [] })).toEqual({});
  });

  it('キーを渡したときだけ両方を載せる', () => {
    expect(imageFieldsForUpdate({ imageKeys: ['a'] })).toEqual({ imageKey: null, imageKeys: ['a'] });
  });
});
