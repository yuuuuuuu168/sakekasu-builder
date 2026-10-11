// Issue sakekasu-builder-archive#172: 大きすぎる画像は、S3 の応答ヘッダの大きさを見て
// 本体を読む前に落とす

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: sendMock };
  }),
  GetObjectCommand: vi.fn(),
}));
// モデルの呼び出し口（Claude API / Bedrock）は使わないので、SDK ごと読み込まない
vi.mock('../../shared/llm', () => ({
  createLlmClient: () => ({ callTool: vi.fn() }),
}));

import {
  MAX_ORIGINAL_IMAGE_BYTES,
  assertStoredImageFitsBedrockLimit,
  handler,
} from '../index.js';

/** Bedrock 側の上限（base64 エンコード後） */
const BASE64_LIMIT = 5 * 1024 * 1024;

const SUB = '11111111-2222-3333-4444-555555555555';

function eventFor(imageKeys: string[]) {
  const [imageKey, ...additionalImageKeys] = imageKeys;
  return {
    info: { fieldName: 'analyzeSakeLabel' },
    arguments: { imageKey, additionalImageKeys },
    identity: { sub: SUB },
  };
}

/** 本体の読み出しと破棄を見張れる S3 の応答を作る */
function storedObject(contentLength: number | undefined) {
  return {
    ContentLength: contentLength,
    ContentType: 'image/jpeg',
    Body: {
      transformToByteArray: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
      destroy: vi.fn(),
    },
  };
}

describe('MAX_ORIGINAL_IMAGE_BYTES', () => {
  it('base64 にして上限ちょうどになる原本の大きさ（3.75MB）', () => {
    expect(MAX_ORIGINAL_IMAGE_BYTES).toBe(3_932_160);
    expect(Math.ceil(MAX_ORIGINAL_IMAGE_BYTES / 3) * 4).toBe(BASE64_LIMIT);
  });

  it('1バイトでも超えると base64 が上限を超える', () => {
    expect(Math.ceil((MAX_ORIGINAL_IMAGE_BYTES + 1) / 3) * 4).toBeGreaterThan(BASE64_LIMIT);
  });
});

describe('assertStoredImageFitsBedrockLimit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('上限ちょうどは通す', () => {
    expect(() => assertStoredImageFitsBedrockLimit(0, MAX_ORIGINAL_IMAGE_BYTES)).not.toThrow();
  });

  it('上限を1バイト超えたら、一括読み取りが見ている文言で落とす', () => {
    expect(() => assertStoredImageFitsBedrockLimit(0, MAX_ORIGINAL_IMAGE_BYTES + 1)).toThrow(
      'Image too large for OCR',
    );
  });

  it('大きさが返らないときは通し、base64 後の判定に任せる', () => {
    expect(() => assertStoredImageFitsBedrockLimit(0, undefined)).not.toThrow();
  });

  it('落とすときに位置と大きさだけをログに出す', () => {
    const spy = vi.spyOn(console, 'error');

    expect(() => assertStoredImageFitsBedrockLimit(2, MAX_ORIGINAL_IMAGE_BYTES + 1)).toThrow();

    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('index=2');
    expect(logged).toContain(`bytes=${MAX_ORIGINAL_IMAGE_BYTES + 1}`);
  });
});

describe('handler の取得順', () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('大きすぎる画像は本体を読まずに落とし、本体を閉じる', async () => {
    const tooLarge = storedObject(MAX_ORIGINAL_IMAGE_BYTES + 1);
    sendMock.mockResolvedValueOnce(tooLarge);

    await expect(handler(eventFor([`${SUB}/purchase/a.jpg`]))).rejects.toThrow(
      'Image too large for OCR',
    );
    expect(tooLarge.Body.transformToByteArray).not.toHaveBeenCalled();
    expect(tooLarge.Body.destroy).toHaveBeenCalledOnce();
  });

  it('2枚目が大きすぎれば、そこで止めて3枚目は取りにいかない', async () => {
    const first = storedObject(1000);
    const second = storedObject(MAX_ORIGINAL_IMAGE_BYTES + 1);
    sendMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await expect(
      handler(
        eventFor([`${SUB}/purchase/a.jpg`, `${SUB}/purchase/b.jpg`, `${SUB}/purchase/c.jpg`]),
      ),
    ).rejects.toThrow('Image too large for OCR');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(second.Body.transformToByteArray).not.toHaveBeenCalled();
  });

  it('S3 からの取得の失敗は、大きさの判定と混同しない', async () => {
    sendMock.mockRejectedValueOnce(new Error('NoSuchKey'));

    await expect(handler(eventFor([`${SUB}/purchase/a.jpg`]))).rejects.toThrow(
      'Failed to retrieve image from storage',
    );
  });

  it('本体の読み出しの失敗も、取得の失敗として扱う', async () => {
    const broken = storedObject(1000);
    broken.Body.transformToByteArray.mockRejectedValueOnce(new Error('socket hang up'));
    sendMock.mockResolvedValueOnce(broken);

    await expect(handler(eventFor([`${SUB}/purchase/a.jpg`]))).rejects.toThrow(
      'Failed to retrieve image from storage',
    );
  });
});
