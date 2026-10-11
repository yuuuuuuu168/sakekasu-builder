import { LayoutGrid } from 'lucide-react';

import { PORTAL_APPS_URL } from '../amplifyConfig';

/**
 * ログイン後のヘッダーに置く「アプリ一覧」。4 アプリの入口の一覧へ同じタブで移る。
 * 共通ログインのセッションはそのまま残るので、一覧から別のアプリへも入力なしで入れる
 */
export function PortalAppsLink() {
  return (
    <a
      href={PORTAL_APPS_URL}
      aria-label="アプリ一覧"
      data-testid="portal-apps-link"
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-gray-600 transition-colors hover:bg-gray-500/10 dark:text-gray-300"
    >
      <LayoutGrid className="size-3.5 shrink-0" aria-hidden="true" />
      {/* 狭い端末ではアイコンだけにする（aria-label があるので読み上げは変わらない） */}
      <span className="max-[359px]:hidden">アプリ一覧</span>
    </a>
  );
}
