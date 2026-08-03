export type SakeCategory = 'NIHONSHU' | 'BEER' | 'WINE' | 'WHISKY' | 'SHOCHU' | 'OTHER';

export const SAKE_CATEGORIES: SakeCategory[] = [
  'NIHONSHU',
  'BEER',
  'WINE',
  'WHISKY',
  'SHOCHU',
  'OTHER',
];

export interface PurchaseFormData {
  sakeName: string;
  storeName: string;
  price: string;
  quantity: string;
  purchaseDate: string;
  category: SakeCategory;
  memo: string;
}

export interface ValidationErrors {
  sakeName?: string;
  storeName?: string;
  price?: string;
  quantity?: string;
  purchaseDate?: string;
  category?: string;
}

export interface SaveResult {
  success: boolean;
  error?: string;
}
