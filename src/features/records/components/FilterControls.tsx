import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import { MAX_SEARCH_QUERY_LENGTH } from '../lib/filterStorage';
import { countActiveAdvancedFilters } from '../lib/advancedFilters';
import { FilterSelect } from './FilterSelect';
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

const RATING_SELECT_OPTIONS = RATING_FILTER_OPTIONS.map((opt) => ({
  value: ratingToValue(opt.value),
  label: opt.label,
}));

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
  // 入力欄と詳細パネルの id。一覧が2つ並んでも衝突しないよう useId で作る
  const searchId = useId();
  const dateFromId = useId();
  const dateToId = useId();
  const advancedPanelId = useId();

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
        <FilterSelect
          label="記録種別"
          value={recordType}
          options={RECORD_TYPE_OPTIONS}
          onChange={onRecordTypeChange}
          testId="filter-record-type"
        />
        <FilterSelect
          label="カテゴリ"
          value={category}
          options={CATEGORY_FILTER_OPTIONS}
          onChange={onCategoryChange}
          testId="filter-category"
        />
        <FilterSelect
          label="並び替え"
          value={sortOption}
          options={SORT_OPTIONS}
          onChange={onSortChange}
          testId="sort-option"
          placeholder="日付（新しい順）"
        />
      </div>

      {/* キーワード検索 + 詳細の開閉 + リセット */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
          <label className="text-xs text-muted-foreground" htmlFor={searchId}>
            キーワード検索
          </label>
          <Input
            id={searchId}
            type="text"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            placeholder="銘柄・店・場所・メモから検索..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            // 文字サイズは Input の既定（スマホ 16px / md 以上 14px）に任せる。
            // 16px を下回ると iOS Safari が入力欄を触った拍子に画面を拡大し、
            // そのまま戻らないので、横にはみ出た表示になる
            className="min-h-[44px]"
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
          aria-controls={advancedPanelId}
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
          id={advancedPanelId}
          className="space-y-3 rounded-md border border-border p-3"
          data-testid="filter-advanced-panel"
        >
          <div className="flex flex-wrap gap-3">
            <FilterSelect
              label="飲みきり"
              value={drinkingStatusFilter}
              options={DRINKING_STATUS_OPTIONS}
              onChange={onDrinkingStatusChange}
              testId="filter-drinking-status"
            />
            <FilterSelect
              label="評価"
              value={ratingToValue(ratingFilter)}
              options={RATING_SELECT_OPTIONS}
              onChange={(val) => onRatingChange(valueToRating(val))}
              testId="filter-rating"
            />
            <FilterSelect
              label="価格帯"
              value={priceRangeFilter}
              options={PRICE_RANGE_OPTIONS}
              onChange={onPriceRangeChange}
              testId="filter-price-range"
            />
            <FilterSelect
              label="日付"
              value={dateRangeFilter}
              options={DATE_RANGE_OPTIONS}
              onChange={onDateRangeChange}
              testId="filter-date-range"
            />
          </div>

          {/* カスタム範囲の開始日・終了日。範囲を選んだときだけ出す。
              片側だけの指定も許すので、どちらも必須にはしない。
              開始日に max、終了日に min を渡して、逆転した範囲（1件も出ない）を
              そもそも選べないようにしている */}
          {dateRangeFilter === 'custom' && (
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor={dateFromId}>
                  開始日
                </label>
                <Input
                  id={dateFromId}
                  type="date"
                  value={customDateFrom}
                  max={customDateTo || undefined}
                  onChange={(e) => onCustomDateFromChange(e.target.value)}
                  className="min-h-[44px]"
                  data-testid="filter-date-from"
                />
              </div>
              <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
                <label className="text-xs text-muted-foreground" htmlFor={dateToId}>
                  終了日
                </label>
                <Input
                  id={dateToId}
                  type="date"
                  value={customDateTo}
                  min={customDateFrom || undefined}
                  onChange={(e) => onCustomDateToChange(e.target.value)}
                  className="min-h-[44px]"
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
