import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  fetchMFAPreference,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
} from 'aws-amplify/auth';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { TOTP_CODE_PATTERN } from '@/features/auth/validation';

/**
 * ダイアログ内の表示状態
 * - loading: 現在の MFA 設定を取得中
 * - error: 現在の設定を取得できなかった（操作ボタンを出さない）
 * - disabled: MFA 未設定（有効化ボタンを表示）
 * - setup: QR コードと確認コード入力を表示中
 * - enabled: MFA 設定済み（解除ボタンを表示）
 * - confirmDisable: 解除前の確認を表示中
 */
type MfaView = 'loading' | 'error' | 'disabled' | 'setup' | 'enabled' | 'confirmDisable';

interface MfaSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * MFA（二段階認証）の設定ダイアログ
 * 認証アプリ（TOTP）の登録・解除を行う
 */
export function MfaSettingsDialog({ open, onClose }: MfaSettingsDialogProps) {
  const { user } = useAuth();
  const [view, setView] = useState<MfaView>('loading');
  const [setupUri, setSetupUri] = useState('');
  const [sharedSecret, setSharedSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPreference = useCallback(() => {
    setView('loading');
    setError('');
    setCode('');

    fetchMFAPreference()
      .then((preference) => {
        setView(preference.enabled?.includes('TOTP') ? 'enabled' : 'disabled');
      })
      .catch(() => {
        // 取得に失敗したとき「未設定」に倒すと、設定済みの利用者が再登録に進んで
        // 既存の認証アプリ登録を上書きしてしまう。判別できない間は
        // 操作ボタンを出さないエラー表示に留める
        setView('error');
      });
  }, []);

  // 開くたびに現在の設定を取り直す（別端末で変更されていても正しく表示する）
  useEffect(() => {
    if (!open) {
      // 共有シークレットは表示が終わったら state に残さない。
      // ダイアログを閉じた後もセッション中ずっと保持していると、
      // XSS が混入したときに読み出せる範囲が広がる
      setSetupUri('');
      setSharedSecret('');
      return;
    }
    loadPreference();
  }, [open, loadPreference]);

  /** TOTP の登録を開始し、QR コードを表示する */
  const handleStartSetup = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const totpSetup = await setUpTOTP();
      // 認証アプリには「発行者 + アカウント名」で表示される
      const uri = totpSetup.getSetupUri('sakekasu-builder', user?.email).toString();
      setSetupUri(uri);
      setSharedSecret(totpSetup.sharedSecret);
      setView('setup');
    } catch {
      setError('設定を開始できませんでした。もう一度お試しください');
    } finally {
      setIsSubmitting(false);
    }
  };

  /** 認証アプリのコードを検証し、MFA を有効化する */
  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // 形式外の入力を Cognito に送ると検証の試行回数だけを消費する
    if (!TOTP_CODE_PATTERN.test(code)) {
      setError('確認コードは 6 桁の数字で入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      await verifyTOTPSetup({ code });
      // 検証だけでは MFA は使われない。優先方式として登録して初めて
      // サインイン時にコードを求められるようになる
      await updateMFAPreference({ totp: 'PREFERRED' });
      setCode('');
      // 登録が済んだ共有シークレットを持ち続けない（閉じるときと同じ理由）
      setSetupUri('');
      setSharedSecret('');
      setView('enabled');
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';
      if (errorName === 'EnableSoftwareTokenMFAException' || errorName === 'CodeMismatchException') {
        setError('確認コードが正しくありません。認証アプリのコードを入れ直してください');
      } else {
        setError('確認に失敗しました。もう一度お試しください');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** MFA を解除する */
  const handleDisable = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await updateMFAPreference({ totp: 'DISABLED' });
      setView('disabled');
    } catch {
      setError('解除に失敗しました。もう一度お試しください');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] overflow-y-auto bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          data-testid="mfa-dialog-overlay"
        >
          {/* ダイアログ自身に max-h を付けて中央寄せすると、ソフトキーボードで
              表示領域が縮んだときに上側（QR コード）が画面外へ切れてスクロールでも
              届かなくなる。スクロールはオーバーレイ側に持たせ、内容が収まるときだけ
              min-h-full の flex で中央に寄せる */}
          <div className="flex min-h-full items-center justify-center px-4 py-6">
            <motion.div
              className="w-full max-w-sm rounded-xl bg-background p-5 shadow-xl"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mfa-dialog-title"
              data-testid="mfa-dialog"
            >
              {/* ヘッダー */}
              <div className="mb-4 flex items-center justify-between">
                <h2 id="mfa-dialog-title" className="text-lg font-bold text-foreground">
                  二段階認証（MFA）
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10"
                  aria-label="閉じる"
                  data-testid="mfa-dialog-close"
                >
                  <X className="size-5" />
                </button>
              </div>

              {view === 'loading' && (
                <div className="flex items-center justify-center py-8" data-testid="mfa-loading">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {view === 'error' && (
                <div className="space-y-4" data-testid="mfa-fetch-error-view">
                  <p className="text-sm text-muted-foreground">
                    現在の設定を取得できませんでした。通信環境をご確認のうえ、再試行してください。
                  </p>
                  <Button
                    onClick={loadPreference}
                    className="w-full h-10 font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
                    data-testid="mfa-retry"
                  >
                    再試行
                  </Button>
                </div>
              )}

              {view === 'disabled' && (
                <div className="space-y-4" data-testid="mfa-disabled-view">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldOff className="size-5 shrink-0" />
                    <span>二段階認証は設定されていません</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    認証アプリ（Google Authenticator など）を使うと、パスワードが漏れても
                    アカウントを守れます。
                  </p>
                  <Button
                    onClick={() => void handleStartSetup()}
                    disabled={isSubmitting}
                    className="w-full h-10 font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
                    data-testid="mfa-start-setup"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        準備中...
                      </>
                    ) : (
                      '設定を始める'
                    )}
                  </Button>
                </div>
              )}

              {view === 'setup' && (
                <form onSubmit={handleVerify} className="space-y-4" data-testid="mfa-setup-view">
                  <p className="text-sm text-muted-foreground">
                    認証アプリで QR コードを読み取り、表示された 6 桁のコードを入力してください。
                  </p>

                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <QRCodeSVG value={setupUri} size={176} data-testid="mfa-qr-code" />
                  </div>

                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">
                      QR コードを読み取れない場合
                    </summary>
                    <p className="mt-2">
                      次のキーを認証アプリに手動で入力してください：
                    </p>
                    <code className="mt-1 block break-all rounded bg-foreground/5 p-2" data-testid="mfa-secret">
                      {sharedSecret}
                    </code>
                  </details>

                  <div className="space-y-1.5">
                    <label htmlFor="mfa-verify-code" className="text-sm font-medium text-foreground">
                      確認コード
                    </label>
                    <Input
                      id="mfa-verify-code"
                      data-testid="mfa-verify-code"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoComplete="one-time-code"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-10 font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
                    data-testid="mfa-verify-submit"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        確認中...
                      </>
                    ) : (
                      '有効にする'
                    )}
                  </Button>
                </form>
              )}

              {view === 'enabled' && (
                <div className="space-y-4" data-testid="mfa-enabled-view">
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <ShieldCheck className="size-5 shrink-0" />
                    <span>二段階認証が有効です</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    サインイン時に認証アプリの 6 桁コードが必要になります。
                    機種変更などで認証アプリを使えなくなる前に、解除してから移行してください。
                  </p>
                  <Button
                    onClick={() => {
                      setError('');
                      setView('confirmDisable');
                    }}
                    variant="destructive"
                    className="w-full h-10 font-semibold"
                    data-testid="mfa-disable"
                  >
                    二段階認証を解除する
                  </Button>
                </div>
              )}

              {view === 'confirmDisable' && (
                <div className="space-y-4" data-testid="mfa-confirm-disable-view">
                  <p className="text-sm font-medium text-foreground">二段階認証を解除しますか？</p>
                  <p className="text-sm text-muted-foreground">
                    解除すると、パスワードだけでサインインできる状態に戻ります。
                    パスワードが漏れたときの守りがなくなるため、ご注意ください。
                  </p>
                  <Button
                    onClick={() => void handleDisable()}
                    disabled={isSubmitting}
                    variant="destructive"
                    className="w-full h-10 font-semibold"
                    data-testid="mfa-disable-confirm"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        解除中...
                      </>
                    ) : (
                      '解除する'
                    )}
                  </Button>
                  <Button
                    onClick={() => setView('enabled')}
                    disabled={isSubmitting}
                    variant="outline"
                    className="w-full h-10 font-semibold"
                    data-testid="mfa-disable-cancel"
                  >
                    やめる
                  </Button>
                </div>
              )}

              {error && (
                <p
                  className="mt-3 text-sm text-destructive"
                  role="alert"
                  data-testid="mfa-error"
                >
                  {error}
                </p>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
