/**
 * 読み込み中の表示。ログイン状態を確かめている間と、自動でマネージドログインへ
 * 送っている間に出す。両方で同じものを出すので、開いてから移るまで画面が切り替わらない
 */
export function AuthLoading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      data-testid="auth-loading"
    >
      <div className="text-center space-y-3">
        <div className="text-3xl">🍶</div>
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    </div>
  );
}
