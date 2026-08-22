import { useCallback, useRef, useState } from 'react';
import type { SakeCategory } from '@/features/purchase/types';
import {
  appendTastingNoteToMemo,
  hasTastingNote,
  supportsTastingNote,
} from '@/features/tasting/lib/tastingNoteMemo';
import { requestTastingNote } from '@/features/tasting/lib/requestTastingNote';

export interface UseTastingNoteReturn {
  /**
   * 備考にテイスティングノートを足した文字列を返す。
   *
   * 対象外カテゴリ・記載済み・生成失敗のいずれでも、渡された備考をそのまま返す。
   * 呼び出し側は結果をそのまま保存すればよい
   */
  fillMemo: (memo: string, sakeName: string, category: SakeCategory) => Promise<string>;
  /** 生成中フラグ（登録ボタンの表示に使う） */
  isGenerating: boolean;
}

/**
 * 登録・更新の直前に、備考へテイスティングノートを足すためのフック。
 *
 * 画像を選んだ時点ではなく登録ボタンを押した時点で動かす。銘柄名は OCR の後に
 * 手で直されることがあり、画像側に紐づけると直す前の名前でノートを書いてしまう。
 */
export function useTastingNote(): UseTastingNoteReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  // 連打などで登録処理が重なっても、フラグが先に落ちて「生成中」表示が
  // 消えないよう、実行中の数で管理する
  const inFlightRef = useRef(0);

  const fillMemo = useCallback(
    async (memo: string, sakeName: string, category: SakeCategory): Promise<string> => {
      // ウイスキー・日本酒以外には書かない。すでに書いてあるものも触らない
      if (!supportsTastingNote(category) || hasTastingNote(memo)) {
        return memo;
      }
      const trimmedName = sakeName.trim();
      if (trimmedName === '') {
        return memo;
      }

      inFlightRef.current += 1;
      setIsGenerating(true);
      try {
        const note = await requestTastingNote(trimmedName, category);
        return appendTastingNoteToMemo(memo, note);
      } finally {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) {
          setIsGenerating(false);
        }
      }
    },
    [],
  );

  return { fillMemo, isGenerating };
}
