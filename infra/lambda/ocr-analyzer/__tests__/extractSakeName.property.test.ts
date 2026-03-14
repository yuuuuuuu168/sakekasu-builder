// Feature: ai-ocr-sake-name, Property 2: Confidence スコアの範囲不変条件

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { extractSakeName, type TextDetection } from '../extractSakeName.js';

/**
 * **Validates: Requirements 3.2**
 *
 * Property 2: Confidence スコアの範囲不変条件
 *
 * 任意の TextDetection リストを extractSakeName に入力した場合、
 * 返される confidence 値は 0.0 以上 1.0 以下の範囲内であること。
 */
describe('Property 2: Confidence スコアの範囲不変条件', () => {
  /** ランダムな TextDetection を生成する arbitrary */
  const textDetectionArb: fc.Arbitrary<TextDetection> = fc.record({
    DetectedText: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
    Type: fc.option(fc.constantFrom('LINE' as const, 'WORD' as const), { nil: undefined }),
    Confidence: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  });

  const textDetectionListArb = fc.array(textDetectionArb, { minLength: 0, maxLength: 30 });

  it('任意の TextDetection リストに対して confidence が 0.0〜1.0 の範囲内である', () => {
    fc.assert(
      fc.property(textDetectionListArb, (detections) => {
        const result = extractSakeName(detections);

        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: ai-ocr-sake-name, Property 3: 最高 Confidence 候補の選択

/**
 * **Validates: Requirements 3.3**
 *
 * Property 3: 最高 Confidence 候補の選択
 *
 * 任意の複数の銘柄名候補を含む TextDetection リストに対して、
 * extractSakeName が返す sakeName は、非銘柄情報を除外した後の候補の中で
 * 最も高い Confidence を持つテキストであること。
 */
describe('Property 3: 最高 Confidence 候補の選択', () => {
  /**
   * 非銘柄パターンに一致しないブランド名風テキストを生成する arbitrary
   * カタカナ・ひらがな・漢字風の短い文字列で、フィルタパターンを避ける
   */
  const brandNameArb = fc.constantFrom(
    '獺祭',
    '八海山',
    '久保田',
    '黒龍',
    '十四代',
    '飛露喜',
    '而今',
    '田酒',
    '新政',
    '鍋島',
    '花陽浴',
    '磯自慢',
    '写楽',
    '仙禽',
    '風の森',
    '紀土',
    '作',
    '天美',
    '光栄菊',
    '赤武',
  );

  /**
   * 有効な銘柄名候補の TextDetection を生成する arbitrary
   * LINE タイプ、非銘柄テキスト、0-100 の Confidence
   */
  const brandCandidateArb = fc.record({
    DetectedText: brandNameArb,
    Type: fc.constant('LINE' as const),
    Confidence: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  });

  /**
   * ノイズ用の非銘柄 TextDetection を生成する arbitrary（WORD タイプや非銘柄テキスト）
   */
  const noiseDetectionArb = fc.oneof(
    // WORD タイプ（LINE でないので候補にならない）
    fc.record({
      DetectedText: brandNameArb,
      Type: fc.constant('WORD' as const),
      Confidence: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    }),
    // 非銘柄パターンに一致するテキスト（フィルタで除外される）
    fc.record({
      DetectedText: fc.constantFrom(
        '720ml',
        '1800mL',
        '15%',
        '16度',
        'アルコール分15度',
        '○○酒造株式会社',
        '醸造元',
        '原材料名',
        '米こうじ',
        '要冷蔵',
        '冷暗所保存',
        '新潟県長岡市',
        '山形県天童市',
      ),
      Type: fc.constant('LINE' as const),
      Confidence: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    }),
  );

  it('最高 Confidence の銘柄名候補が sakeName として選択される', () => {
    fc.assert(
      fc.property(
        // 少なくとも2つの銘柄名候補を生成（複数候補のテスト）
        fc.array(brandCandidateArb, { minLength: 2, maxLength: 10 }),
        fc.array(noiseDetectionArb, { minLength: 0, maxLength: 10 }),
        (brandCandidates, noiseDetections) => {
          // ブランド候補とノイズを混ぜてシャッフル
          const allDetections: TextDetection[] = [...brandCandidates, ...noiseDetections];

          const result = extractSakeName(allDetections);

          // 期待される最高 Confidence 候補を手動で計算
          let expectedBest = brandCandidates[0];
          for (let i = 1; i < brandCandidates.length; i++) {
            if ((brandCandidates[i].Confidence ?? 0) > (expectedBest.Confidence ?? 0)) {
              expectedBest = brandCandidates[i];
            }
          }

          // sakeName が null でないこと（有効な候補が存在するため）
          expect(result.sakeName).not.toBeNull();

          // 選択された sakeName の confidence が最高 Confidence 候補と一致すること
          expect(result.confidence).toBeCloseTo((expectedBest.Confidence ?? 0) / 100, 10);

          // 選択された sakeName が最高 Confidence 候補のテキストであること
          expect(result.sakeName).toBe(expectedBest.DetectedText);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: ai-ocr-sake-name, Property 4: 非銘柄情報のフィルタリング

/**
 * **Validates: Requirements 3.4**
 *
 * Property 4: 非銘柄情報のフィルタリング
 *
 * 任意の容量表記・アルコール度数・製造者名等の非銘柄パターンに一致するテキストを含む
 * TextDetection リストに対して、extractSakeName はそれらのテキストを銘柄名候補として
 * 選択しないこと。
 */
describe('Property 4: 非銘柄情報のフィルタリング', () => {
  /** 容量表記を生成する arbitrary */
  const volumeTextArb = fc
    .tuple(
      fc.integer({ min: 1, max: 9999 }),
      fc.constantFrom('ml', 'mL', 'ML', 'ℓ', 'リットル'),
    )
    .map(([num, unit]) => `${num}${unit}`);

  /** アルコール度数を生成する arbitrary */
  const alcoholTextArb = fc.oneof(
    fc
      .tuple(fc.integer({ min: 1, max: 99 }), fc.constantFrom('%', '％', '度'))
      .map(([num, suffix]) => `${num}${suffix}`),
    fc.integer({ min: 1, max: 99 }).map((n) => `アルコール分${n}度`),
    fc.constant('アルコール'),
  );

  /** 製造者名を生成する arbitrary */
  const manufacturerTextArb = fc
    .tuple(
      fc.constantFrom('山田', '中川', '松竹', '梅田', '川中', '田中'),
      fc.constantFrom('製造', '醸造', '酒造', '株式会社', '有限会社', '合名会社'),
    )
    .map(([prefix, suffix]) => `${prefix}${suffix}`);

  /** 原材料テキストを生成する arbitrary */
  const ingredientTextArb = fc.constantFrom(
    '原材料名',
    '原材料',
    '米',
    '米こうじ',
    '醸造アルコール',
    '原材料: 米、米こうじ',
  );

  /** 保存方法テキストを生成する arbitrary */
  const storageTextArb = fc.constantFrom(
    '保存方法',
    '要冷蔵',
    '冷暗所保存',
    '冷暗所にて保存してください',
  );

  /** 産地表記テキストを生成する arbitrary（3文字以上） */
  const regionTextArb = fc.constantFrom(
    '新潟県長岡市',
    '山形県天童市',
    '秋田県横手市',
    '兵庫県神戸市',
    '京都府伏見区',
    '広島県東広島市',
    '佐賀県鹿島市',
    '福島県会津若松市',
    '北海道旭川市',
    '東京都港区',
  );

  /** 全ての非銘柄パターンからランダムに選択する arbitrary */
  const nonBrandTextArb = fc.oneof(
    volumeTextArb,
    alcoholTextArb,
    manufacturerTextArb,
    ingredientTextArb,
    storageTextArb,
    regionTextArb,
  );

  /** 非銘柄テキストの TextDetection を生成する arbitrary（LINE タイプ） */
  const nonBrandDetectionArb = fc.record({
    DetectedText: nonBrandTextArb,
    Type: fc.constant('LINE' as const),
    Confidence: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  });

  /** ブランド名の arbitrary（非銘柄パターンに一致しない） */
  const brandNameArb = fc.constantFrom(
    '獺祭',
    '八海山',
    '久保田',
    '黒龍',
    '十四代',
    '飛露喜',
    '而今',
    '田酒',
    '新政',
    '鍋島',
    '花陽浴',
    '磯自慢',
    '写楽',
    '仙禽',
    '風の森',
    '紀土',
    '作',
    '天美',
    '光栄菊',
    '赤武',
  );

  /** ブランド名の TextDetection を生成する arbitrary */
  const brandDetectionArb = fc.record({
    DetectedText: brandNameArb,
    Type: fc.constant('LINE' as const),
    Confidence: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  });

  it('非銘柄テキストのみの場合、sakeName が null を返す', () => {
    fc.assert(
      fc.property(
        fc.array(nonBrandDetectionArb, { minLength: 1, maxLength: 20 }),
        (nonBrandDetections) => {
          const result = extractSakeName(nonBrandDetections);

          expect(result.sakeName).toBeNull();
          expect(result.confidence).toBe(0.0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('非銘柄テキストとブランドテキストが混在する場合、選択された sakeName は非銘柄テキストでない', () => {
    fc.assert(
      fc.property(
        fc.array(nonBrandDetectionArb, { minLength: 1, maxLength: 10 }),
        fc.array(brandDetectionArb, { minLength: 1, maxLength: 5 }),
        (nonBrandDetections, brandDetections) => {
          const allDetections = [...nonBrandDetections, ...brandDetections];
          const result = extractSakeName(allDetections);

          // ブランド候補が存在するので sakeName は null でない
          expect(result.sakeName).not.toBeNull();

          // 選択された sakeName が非銘柄テキストのいずれとも一致しないこと
          const nonBrandTexts = nonBrandDetections.map((d) => d.DetectedText);
          expect(nonBrandTexts).not.toContain(result.sakeName);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: ai-ocr-sake-name, Property 5: rawTexts の完全性

/**
 * **Validates: Requirements 3.6**
 *
 * Property 5: rawTexts の完全性
 *
 * 任意の TextDetection リストに対して、extractSakeName が返す rawTexts フィールドは、
 * 入力された全ての LINE タイプのテキスト検出結果の DetectedText を含むこと。
 */
describe('Property 5: rawTexts の完全性', () => {
  /** ランダムな TextDetection を生成する arbitrary（LINE と WORD の混在） */
  const textDetectionArb: fc.Arbitrary<TextDetection> = fc.record({
    DetectedText: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    Type: fc.option(fc.constantFrom('LINE' as const, 'WORD' as const), { nil: undefined }),
    Confidence: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  });

  const textDetectionListArb = fc.array(textDetectionArb, { minLength: 0, maxLength: 30 });

  it('rawTexts が全 LINE タイプの DetectedText を含む', () => {
    fc.assert(
      fc.property(textDetectionListArb, (detections) => {
        const result = extractSakeName(detections);

        // 期待される rawTexts: LINE タイプかつ DetectedText が定義されているもの全て
        const expectedRawTexts = detections
          .filter((d) => d.Type === 'LINE')
          .map((d) => d.DetectedText)
          .filter((text): text is string => text != null);

        // rawTexts が期待される全テキストを含むこと
        expect(result.rawTexts).toEqual(expectedRawTexts);
      }),
      { numRuns: 100 },
    );
  });

  it('WORD タイプのテキストは rawTexts に含まれない', () => {
    /** WORD タイプのみの TextDetection を生成する arbitrary */
    const wordOnlyDetectionArb = fc.record({
      DetectedText: fc.string({ minLength: 1, maxLength: 30 }),
      Type: fc.constant('WORD' as const),
      Confidence: fc.double({ min: 0, max: 100, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.array(wordOnlyDetectionArb, { minLength: 1, maxLength: 20 }),
        (wordDetections) => {
          const result = extractSakeName(wordDetections);

          // WORD タイプのみの場合、rawTexts は空であること
          expect(result.rawTexts).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
