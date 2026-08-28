import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { MAX_SEARCH_QUERY_LENGTH } from '../lib/filterStorage';
import { countActiveAdvancedFilters } from '../lib/advancedFilters';
import {
  RECORD_TYPE_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  SORT_OPTIONS,
  DRINKING_STATUS_OPTIONS,
  RATING_FILTER_OPTIONS,
  PRICE_RANGE_OPTIONS,
  DATE_RANGE_OPTIONS,
  type RecordTypeFilter,
  type CategoryFilter,
  type SortOption,
  type DrinkingStatusFilter,
  type RatingFilter,
  type PriceRangeFilter,
  type DateRangeFilter,
} from '../types';

interface FilterControlsProps {
  recordType: RecordTypeFilter;
  category: CategoryFilter;
  searchQuery: string;
  sortOption: SortOption;
  drinkingStatusFilter: DrinkingStatusFilter;
  ratingFilter: RatingFilter;
  priceRangeFilter: PriceRangeFilter;
  dateRangeFilter: DateRangeFilter;
  customDateFrom: string;
  customDateTo: string;
  hasActiveFilter: boolean;
  onRecordTypeChange: (type: RecordTypeFilter) => void;
  onCategoryChange: (category: CategoryFilter) => void;
  onSearchQueryChange: (query: string) => void;
  onSortChange: (option: SortOption) => void;
  onDrinkingStatusChange: (status: DrinkingStatusFilter) => void;
  onRatingChange: (rating: RatingFilter) => void;
  onPriceRangeChange: (priceRange: PriceRangeFilter) => void;
  onDateRangeChange: (dateRange: DateRangeFilter) => void;
  onCustomDateFromChange: (date: string) => void;
  onCustomDateToChange: (date: string) => void;
  onReset: () => void;
}

/** Select は文字列しか扱えないので、評価フィルタは値を文字列と行き来させる */
function ratingToValue(rating: RatingFilter): string {
  return String(rating);
}

function valueToRating(value: string): RatingFilter {
  return value === 'all' ? 'all' : (Number(value) as RatingFilter);
}

/**
 * 選択が外れたとき（null）は何もしない。
 *
 * base-ui の Select は、選ばれている項目をもう一度押すと解除として null を
 * 渡してくる。そのまま絞り込みへ入れると、どの条件にも一致しなくなって
 * 記録が1件も出なくなる。解除は「操作なし」として扱い、今の絞り込みを残す
 */
function onlyWhenSelected<T>(handler: (value: T) => void) {
  return (value: string | null) => {
    if (value !== null) {
      handler(value as T);
    }
  };
}

export function FilterControls({
  recordType,
  category,
  searchQuery,
  sortOption,
  drinkingStatusFilter,
  ratingFilter,
  priceRangeFilter,
  dateRangeFilter,
  customDateFrom,
  customDateTo,
  hasActiveFilter,
  onRecordTypeChange,
  onCategoryChange,
  onSearchQueryChange,
  onSortChange,
  onDrinkingStatusChange,
  onRatingChange,
  onPriceRangeChange,
  onDateRangeChange,
  onCustomDateFromChange,
  onCustomDateToChange,
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
  const priceRangeLabel = PRICE_RANGE_OPTIONS.find(
    (opt) => opt.value === priceRangeFilter
  )?.label;
  const dateRangeLabel = DATE_RANGE_OPTIONS.find(
    (opt) => opt.value === dateRangeFilter
  )?.label;

  const activeAdvancedCount = countActiveAdvancedFilters({
    drinkingStatus: drinkingStatusFilter,
    rating: ratingFilter,
    priceRange: priceRangeFilter,
    dateRange: dateRangeFilter,
  });

  // 条件が入ったまま隠れていると、記録が出ない理由が分からなくなるので、
  // 効いている詳細条件があれば開いた状態で始める。
  //
  // 初期値だけで足りるのは、詳細条件を変えられるのが開いている間だけだから。
  // 保存した条件からの復元は初回描画の時点で終わっており、タブを移ると
  // 一覧ごとアンマウントされるので、戻ってきたときにもここが効く。
  // effect で開き直すと、条件を残したまま畳む操作ができなくなる
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(activeAdvancedCount > 0);

  return (
    <div className="space-y-3">
      {/* 常時出す条件。記録を探すときにまず触るものだけをここに置く */}
      <div className="flex flex-wrap gap-3">
        {/* 記録種別フィルタ */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">記録種別</label>
          <Select
            value={recordType}
            onValueChange={onlyWhenSelected<RecordTypeFilter>(onRecordTypeChange)}
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
            onValueChange={onlyWhenSelected<CategoryFilter>(onCategoryChange)}
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

        {/* 並び替え */}
        <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
          <label className="text-xs text-muted-foreground">並び替え</label>
          <Select
            value={sortOption}
            onValueChange={onlyWhenSelected<SortOption>(onSortChange)}
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

      {/* キーワード検索 + 詳細の開閉 + リセット */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
          <label className="text-xs text-muted-foreground">キーワード検索</label>
          <Input
            type="text"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            placeholder="銘柄・店・場所・メモから検索..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="min-h-[44px] text-sm"
            data-testid="filter-search"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsAdvancedOpen((open) => !open)}
          className="min-h-[44px] text-sm shrink-0"
          aria-expanded={isAdvancedOpen}
          aria-controls="filter-advanced"
          data-testid="filter-advanced-toggle"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          詳細
          {/* 畳んだままでも、効いている条件の数だけは見えるようにする */}
          {activeAdvancedCount > 0 && (
            <span
              className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground"
              data-testid="filter-advanced-count"
            >
              {activeAdvancedCount}
            </span>
          )}
          <ChevronDown
            className={`size-4 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </Button>
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

      {/* 詳細フィルタ。使う頻度が落ちる条件はここへ畳んでおく */}
      {isAdvancedOpen && (
        <div
          id="filter-advanced"
          className="space-y-3 rounded-md border border-border p-3"
          data-testid="filter-advanced-panel"
        >
          <div className="flex flex-wrap gap-3">
            {/* 飲みきりステータス */}
            <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
              <label className="text-xs text-muted-foreground">飲みきり</label>
              <Select
                value={drinkingStatusFilter}
                onValueChange={onlyWhenSelected<DrinkingStatusFilter>(onDrinkingStatusChange)}
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
                onValueChange={onlyWhenSelected<string>((val) => onRatingChange(valueToRating(val)))}
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

            {/* 価格帯フィルタ */}
            <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
              <label className="text-xs text-muted-foreground">価格帯</label>
              <Select
                value={priceRangeFilter}
                onValueChange={onlyWhenSelected<PriceRangeFilter>(onPriceRangeChange)}
              >
                <SelectTrigger
                  className="w-full min-h-[44px] text-sm"
                  data-testid="filter-price-range"
                >
                  <SelectValue placeholder="すべて">{priceRangeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRICE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 日付範囲フィルタ */}
            <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
              <label className="text-xs text-muted-foreground">日付</label>
              <Select
                value={dateRangeFilter}
                onValueChange={onlyWhenSelected<DateRangeFilter>(onDateRangeChange)}
              >
                <SelectTrigger
                  className="w-full min-h-[44px] text-sm"
                  data-testid="filter-date-range"
                >
                  <SelectValue placeholder="すべて">{dateRangeLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* カスタム範囲の開始日・終了日。範囲を選んだときだけ出す。
              片側だけの指定も許すので、どちらも必須にはしない。
              開始日に max、終了日に min を渡して、逆転した範囲（1件も出ない）を
              そもそも選べないようにしている */}
          {dateRangeFilter === 'custom' && (
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor="filter-date-from">
                  開始日
                </label>
                <Input
                  id="filter-date-from"
                  type="date"
                  value={customDateFrom}
                  max={customDateTo || undefined}
                  onChange={(e) => onCustomDateFromChange(e.target.value)}
                  className="min-h-[44px] text-sm"
                  data-testid="filter-date-from"
                />
              </div>
              <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor="filter-date-to">
                  終了日
                </label>
                <Input
                  id="filter-date-to"
                  type="date"
                  value={customDateTo}
                  min={customDateFrom || undefined}
                  onChange={(e) => onCustomDateToChange(e.target.value)}
                  className="min-h-[44px] text-sm"
                  data-testid="filter-date-to"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
