// Feature: 詳細スペック項目の記録対応（Issue #87）

import { describe, it, expect } from 'vitest';
import {
  applyOcrSpecs,
  createEmptySpecFormData,
  formDataToSpecs,
  hasAnySpecValue,
  pickSakeSpecs,
  specsToCreateInput,
  specsToFormData,
  specsToUpdateInput,
  toSpecDisplayEntries,
  validateSpecFormData,
} from '../lib/sakeSpecs';
import { SPEC_FIELD_NAMES, specFieldsForCategory } from '../types';

describe('詳細スペックの入力値変換', () => {
  it('空のフォームは全項目 null になる', () => {
    const specs = formDataToSpecs(createEmptySpecFormData());

    for (const field of SPEC_FIELD_NAMES) {
      expect(specs[field]).toBeNull();
    }
  });

  it('数値項目は数値に、文字列項目は trim して保存される', () => {
    const specs = formDataToSpecs({
      ...createEmptySpecFormData(),
      brewery: '  旭酒造株式会社  ',
      ricePolishingRatio: '23',
      sakeMeterValue: '-1.5',
    });

    expect(specs.brewery).toBe('旭酒造株式会社');
    expect(specs.ricePolishingRatio).toBe(23);
    expect(specs.sakeMeterValue).toBe(-1.5);
  });

  it('保存済みの値をフォームに戻せる（未設定は空文字）', () => {
    const form = specsToFormData({ brewery: '旭酒造株式会社', ricePolishingRatio: 23 });

    expect(form.brewery).toBe('旭酒造株式会社');
    expect(form.ricePolishingRatio).toBe('23');
    expect(form.yeast).toBe('');
  });

  it('フォーム → 保存値 → フォームで値が変わらない', () => {
    const form = {
      ...createEmptySpecFormData(),
      brewery: '旭酒造株式会社',
      region: '山口県',
      alcoholPercentage: '16',
      volumeMl: '720',
      sakeMeterValue: '-1.5',
    };

    expect(specsToFormData(formDataToSpecs(form))).toEqual(form);
  });

  it('項目を持たない記録（undefined）も null に揃う', () => {
    const specs = pickSakeSpecs({});

    for (const field of SPEC_FIELD_NAMES) {
      expect(specs[field]).toBeNull();
    }
  });

  it('入力済みの項目があるかを判定できる', () => {
    expect(hasAnySpecValue(createEmptySpecFormData())).toBe(false);
    expect(hasAnySpecValue({ ...createEmptySpecFormData(), yeast: '  ' })).toBe(false);
    expect(hasAnySpecValue({ ...createEmptySpecFormData(), yeast: '協会9号' })).toBe(true);
  });
});

describe('mutation へ渡す入力', () => {
  it('作成では値のある項目だけを載せる', () => {
    const input = specsToCreateInput({ ...createEmptySpecFormData(), brewery: '旭酒造' });

    expect(input).toEqual({ brewery: '旭酒造' });
  });

  it('更新では空欄も null として載せる（入力欄を空にしたら消えるように）', () => {
    const input = specsToUpdateInput({ ...createEmptySpecFormData(), brewery: '旭酒造' });

    expect(input.brewery).toBe('旭酒造');
    expect(input.yeast).toBeNull();
    expect(Object.keys(input)).toHaveLength(SPEC_FIELD_NAMES.length);
  });
});

describe('詳細スペックの検証', () => {
  const base = createEmptySpecFormData();

  it('すべて空欄ならエラーにならない（全項目が任意）', () => {
    expect(validateSpecFormData(base)).toEqual({});
  });

  it('範囲外の数値はエラーになる', () => {
    expect(validateSpecFormData({ ...base, ricePolishingRatio: '120' })).toHaveProperty(
      'ricePolishingRatio',
    );
    expect(validateSpecFormData({ ...base, acidity: '0' })).toHaveProperty('acidity');
    expect(validateSpecFormData({ ...base, volumeMl: '0' })).toHaveProperty('volumeMl');
  });

  it('整数の項目に小数を入れるとエラーになる', () => {
    expect(validateSpecFormData({ ...base, volumeMl: '720.5' })).toHaveProperty('volumeMl');
  });

  it('数値として読めない文字列はエラーになる', () => {
    expect(validateSpecFormData({ ...base, acidity: 'あ' })).toHaveProperty('acidity');
  });

  it('日本酒度は負の値でもエラーにならない', () => {
    expect(validateSpecFormData({ ...base, sakeMeterValue: '-5' })).toEqual({});
  });

  it('文字列項目の長さ超過はエラーになる', () => {
    expect(validateSpecFormData({ ...base, brewery: 'あ'.repeat(101) })).toHaveProperty('brewery');
    expect(validateSpecFormData({ ...base, brewery: 'あ'.repeat(100) })).toEqual({});
  });
});

describe('OCR 結果の反映', () => {
  it('入力済みの項目は自動実行では上書きしない', () => {
    const current = { ...createEmptySpecFormData(), brewery: '手で書いた蔵元' };

    const next = applyOcrSpecs(current, { brewery: '旭酒造', region: '山口県' }, {
      overwrite: false,
    });

    expect(next.brewery).toBe('手で書いた蔵元');
    expect(next.region).toBe('山口県');
  });

  it('手動の再読み取りでは読み取れた項目を上書きする', () => {
    const current = { ...createEmptySpecFormData(), brewery: '手で書いた蔵元' };

    const next = applyOcrSpecs(current, { brewery: '旭酒造' }, { overwrite: true });

    expect(next.brewery).toBe('旭酒造');
  });

  it('読み取れなかった項目（null）は入力欄を消さない', () => {
    const current = { ...createEmptySpecFormData(), yeast: '協会9号' };

    const next = applyOcrSpecs(current, { yeast: null }, { overwrite: true });

    expect(next.yeast).toBe('協会9号');
  });
});

describe('表示用の整形', () => {
  it('値のある項目だけを単位付きで返す', () => {
    const entries = toSpecDisplayEntries({
      brewery: '旭酒造株式会社',
      ricePolishingRatio: 23,
      alcoholPercentage: 16,
    });

    expect(entries).toEqual([
      { key: 'brewery', label: '蔵元', value: '旭酒造株式会社' },
      { key: 'alcoholPercentage', label: 'アルコール度数', value: '16%' },
      { key: 'ricePolishingRatio', label: '精米歩合', value: '23%' },
    ]);
  });

  it('日本酒度は正の値に + を付ける（ラベルの表記に合わせる）', () => {
    expect(toSpecDisplayEntries({ sakeMeterValue: 3 })[0].value).toBe('+3');
    expect(toSpecDisplayEntries({ sakeMeterValue: -3 })[0].value).toBe('-3');
    expect(toSpecDisplayEntries({ sakeMeterValue: 0 })[0].value).toBe('0');
  });

  it('スペックを持たない記録では何も返さない', () => {
    expect(toSpecDisplayEntries(undefined)).toEqual([]);
    expect(toSpecDisplayEntries(pickSakeSpecs({}))).toEqual([]);
  });
});

describe('カテゴリごとの表示項目', () => {
  it('日本酒ではすべての項目を出す', () => {
    expect(specFieldsForCategory('NIHONSHU')).toHaveLength(SPEC_FIELD_NAMES.length);
  });

  it('日本酒以外では日本酒向けの項目を出さない', () => {
    const keys = specFieldsForCategory('WHISKY').map((field) => field.key);

    expect(keys).toContain('brewery');
    expect(keys).toContain('alcoholPercentage');
    expect(keys).not.toContain('ricePolishingRatio');
    expect(keys).not.toContain('riceVariety');
  });
});
