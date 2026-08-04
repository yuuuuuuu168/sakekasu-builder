import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  RECORD_TYPE_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  SORT_OPTIONS,
  DRINKING_STATUS_OPTIONS,
  RATING_FILTER_OPTIONS,
  type RecordTypeFilter,
  type CategoryFilter,
  type SortOption,
  type DrinkingStatusFilter,
  type RatingFilter,
} from '../types';

interface FilterControlsProps {
  recordType: RecordTypeFilter;
  category: CategoryFilter;
  searchQuery: string;
  sortOption: SortOption;
  drinkingStatusFilter: DrinkingStatusFilter;
  ratingFilter: RatingFilter;
  hasActiveFilter: boolean;
  onRecordTypeChange: (type: RecordTypeFilter) => void;
  onCategoryChange: (category: CategoryFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onSortChange: (option: SortOption) => void;
  onDrinkingStatusChange: (status: DrinkingStatusFilter) => void;
  onRatingChange: (rating: RatingFilter) => void;
  onReset: () => void;
}

/** Select は文字列しか扱えないので、評価フィルタは値を文字列と行き来させる */
function ratingToValue(rating: RatingFilter): string {
  return String(rating);
}

function valueToRating(value: string): RatingFilter {
  return value === 'all' ? 'all' : (Number(value) as RatingFilter);
}

export function FilterControls({
  recordType,
  category,
  searchQuery,
  sortOption,
  drinkingStatusFilter,
  ratingFilter,
  hasActiveFilter,
  onRecordTypeChange,
  onCategoryChange,
  onSearchQueryChange,
  onSortChange,
  onDrinkingStatusChange,
  onRatingChange,
  onReset,
}: FilterControlsProps) {
  const recordTypeLabel = RECORD_TYPE_OPTIONS.find(
    (opt) => opt.value === recordType
  )?.label;
  const categoryLabel = CATEGORY_FILTER_OPTIONS.find(
    (opt) => opt.value === category
  )?.label;
  const sortLabel = SORT_OPTIONS.find(
    (opt) => opt.value === sortOption
  )?.label;
  const drinkingStatusLabel = DRINKING_STATUS_OPTIONS.find(
    (opt) => opt.value === drinkingStatusFilter
  )?.label;
  const ratingLabel = RATING_FILTER_OPTIONS.find(
    (opt) => opt.value === ratingFilter
  )?.label;

  return (
    <div className="space-y-3">
      {/* セレクト系コントロール */}
      <div className="flex flex-wrap gap-3">
        {/* 記録種別フィルタ */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">記録種別</label>
          <Select
            value={recordType}
            onValueChange={(val) => onRecordTypeChange(val as RecordTypeFilter)}
          >
            <SelectTrigger
              className="w-full min-h-[44px] text-sm"
              data-testid="filter-record-type"
            >
              <SelectValue placeholder="すべて">{recordTypeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RECORD_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* カテゴリフィルタ */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">カテゴリ</label>
          <Select
            value={category}
            onValueChange={(val) => onCategoryChange(val as CategoryFilter)}
          >
            <SelectTrigger
              className="w-full min-h-[44px] text-sm"
              data-testid="filter-category"
            >
              <SelectValue placeholder="すべて">{categoryLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 飲みきりステータス */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">飲みきり</label>
          <Select
            value={drinkingStatusFilter}
            onValueChange={(val) => onDrinkingStatusChange(val as DrinkingStatusFilter)}
          >
            <SelectTrigger
              className="w-full min-h-[44px] text-sm"
              data-testid="filter-drinking-status"
            >
              <SelectValue placeholder="すべて">{drinkingStatusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DRINKING_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 評価フィルタ */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">評価</label>
          <Select
            value={ratingToValue(ratingFilter)}
            onValueChange={(val) => onRatingChange(valueToRating(val))}
          >
            <SelectTrigger
              className="w-full min-h-[44px] text-sm"
              data-testid="filter-rating"
            >
              <SelectValue placeholder="すべて">{ratingLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RATING_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={ratingToValue(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 並び替え */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">並び替え</label>
          <Select
            value={sortOption}
            onValueChange={(val) => onSortChange(val as SortOption)}
          >
            <SelectTrigger
              className="w-full min-h-[44px] text-sm"
              data-testid="sort-option"
            >
              <SelectValue placeholder="日付（新しい順）">{sortLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* キーワード検索 + リセット */}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-xs text-muted-foreground">キーワード検索</label>
          <Input
            type="text"
            placeholder="銘柄・店・場所・メモから検索..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="min-h-[44px] text-sm"
            data-testid="filter-search"
          />
        </div>
        {hasActiveFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="min-h-[44px] text-sm shrink-0"
            data-testid="filter-reset"
          >
            リセット
          </Button>
        )}
      </div>
    </div>
  );
}
