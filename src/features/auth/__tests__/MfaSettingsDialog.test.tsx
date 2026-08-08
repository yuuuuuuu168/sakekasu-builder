import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// aws-amplify/auth の MFA 系 API をモック
const mockFetchMFAPreference = vi.fn();
const mockSetUpTOTP = vi.fn();
const mockVerifyTOTPSetup = vi.fn();
const mockUpdateMFAPreference = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  fetchMFAPreference: (...args: unknown[]) => mockFetchMFAPreference(...args),
  setUpTOTP: (...args: unknown[]) => mockSetUpTOTP(...args),
  verifyTOTPSetup: (...args: unknown[]) => mockVerifyTOTPSetup(...args),
  updateMFAPreference: (...args: unknown[]) => mockUpdateMFAPreference(...args),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'user-123', email: 'test@example.com' },
  }),
}));

import { MfaSettingsDialog } from '../components/MfaSettingsDialog';

describe('MfaSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetUpTOTP.mockResolvedValue({
      sharedSecret: 'SECRETKEY123',
      getSetupUri: (issuer: string, account?: string) =>
        new URL(`otpauth://totp/${issuer}:${account}?secret=SECRETKEY123&issuer=${issuer}`),
    });
  });

  it('閉じているときは何も表示しない', () => {
    mockFetchMFAPreference.mockResolvedValue({});
    render(<MfaSettingsDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByTestId('mfa-dialog')).not.toBeInTheDocument();
    expect(mockFetchMFAPreference).not.toHaveBeenCalled();
  });

  it('MFA 未設定なら有効化への導線を表示する', async () => {
    mockFetchMFAPreference.mockResolvedValue({});
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-disabled-view')).toBeInTheDocument();
    });
    expect(screen.getByText('二段階認証は設定されていません')).toBeInTheDocument();
  });

  it('MFA 設定済みなら解除への導線を表示する', async () => {
    mockFetchMFAPreference.mockResolvedValue({ enabled: ['TOTP'], preferred: 'TOTP' });
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-enabled-view')).toBeInTheDocument();
    });
    expect(screen.getByText('二段階認証が有効です')).toBeInTheDocument();
  });

  it('設定開始で QR コードと手動入力キーを表示する', async () => {
    mockFetchMFAPreference.mockResolvedValue({});
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-start-setup')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-start-setup'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-setup-view')).toBeInTheDocument();
    });
    expect(mockSetUpTOTP).toHaveBeenCalled();
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent('SECRETKEY123');
  });

  it('コード検証が通ったら TOTP を優先方式として登録する', async () => {
    mockFetchMFAPreference.mockResolvedValue({});
    mockVerifyTOTPSetup.mockResolvedValue(undefined);
    mockUpdateMFAPreference.mockResolvedValue(undefined);
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-start-setup')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-start-setup'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-verify-code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('mfa-verify-code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('mfa-verify-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-enabled-view')).toBeInTheDocument();
    });
    expect(mockVerifyTOTPSetup).toHaveBeenCalledWith({ code: '123456' });
    // 検証だけでは MFA は働かない。優先方式の登録まで済ませること
    expect(mockUpdateMFAPreference).toHaveBeenCalledWith({ totp: 'PREFERRED' });
  });

  it('コード誤りのときはエラーを表示して設定画面に留まる', async () => {
    mockFetchMFAPreference.mockResolvedValue({});
    mockVerifyTOTPSetup.mockRejectedValue({ name: 'EnableSoftwareTokenMFAException' });
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-start-setup')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-start-setup'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-verify-code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('mfa-verify-code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByTestId('mfa-verify-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-error')).toHaveTextContent(
        '確認コードが正しくありません',
      );
    });
    expect(screen.getByTestId('mfa-setup-view')).toBeInTheDocument();
    expect(mockUpdateMFAPreference).not.toHaveBeenCalled();
  });

  it('解除は確認を挟んでから TOTP を無効にする', async () => {
    mockFetchMFAPreference.mockResolvedValue({ enabled: ['TOTP'], preferred: 'TOTP' });
    mockUpdateMFAPreference.mockResolvedValue(undefined);
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-disable')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-disable'));

    // ワンクリックでは解除されず、確認画面が出る
    await waitFor(() => {
      expect(screen.getByTestId('mfa-confirm-disable-view')).toBeInTheDocument();
    });
    expect(mockUpdateMFAPreference).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mfa-disable-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-disabled-view')).toBeInTheDocument();
    });
    expect(mockUpdateMFAPreference).toHaveBeenCalledWith({ totp: 'DISABLED' });
  });

  it('解除の確認で「やめる」と設定済み画面に戻る', async () => {
    mockFetchMFAPreference.mockResolvedValue({ enabled: ['TOTP'], preferred: 'TOTP' });
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-disable')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-disable'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-confirm-disable-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mfa-disable-cancel'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-enabled-view')).toBeInTheDocument();
    });
    expect(mockUpdateMFAPreference).not.toHaveBeenCalled();
  });

  // 取得失敗時に「未設定」へ倒すと、設定済みの利用者が再登録に進んで
  // 既存の認証アプリ登録を上書きしてしまう
  it('設定の取得に失敗したら操作ボタンを出さずエラー表示にする', async () => {
    mockFetchMFAPreference.mockRejectedValue(new Error('network'));
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-fetch-error-view')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mfa-start-setup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mfa-disable')).not.toBeInTheDocument();
  });

  it('エラー表示から再試行すると設定を取り直す', async () => {
    mockFetchMFAPreference.mockRejectedValueOnce(new Error('network'));
    mockFetchMFAPreference.mockResolvedValueOnce({ enabled: ['TOTP'], preferred: 'TOTP' });
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-retry')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-enabled-view')).toBeInTheDocument();
    });
  });

  it('形式外のコードは Cognito に送らずエラーを出す', async () => {
    mockFetchMFAPreference.mockResolvedValue({});
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-start-setup')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-start-setup'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-verify-code')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('mfa-verify-code'), {
      target: { value: '12345' },
    });
    fireEvent.submit(screen.getByTestId('mfa-setup-view'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-error')).toHaveTextContent(
        '確認コードは 6 桁の数字で入力してください',
      );
    });
    expect(mockVerifyTOTPSetup).not.toHaveBeenCalled();
  });
});
