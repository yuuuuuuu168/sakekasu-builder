import type { SakeCategory } from '@/types/sake';

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
