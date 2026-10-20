/**
 * 購入・飲酒・記録一覧・統計など、機能をまたいで使う酒の型。
 * 以前は purchase 機能の types に置いていたが、purchase 以外からの参照の方が多い
 */

export type SakeCategory = 'NIHONSHU' | 'BEER' | 'WINE' | 'WHISKY' | 'SHOCHU' | 'OTHER';

export const SAKE_CATEGORIES: SakeCategory[] = [
  'NIHONSHU',
  'BEER',
  'WINE',
  'WHISKY',
  'SHOCHU',
  'OTHER',
];

/** 記録の種別。画像のキーの階層にも使う */
export type RecordType = 'purchase' | 'drinking';

/** 記録の保存（作成・更新）の結果 */
export interface SaveResult {
  success: boolean;
  error?: string;
}
