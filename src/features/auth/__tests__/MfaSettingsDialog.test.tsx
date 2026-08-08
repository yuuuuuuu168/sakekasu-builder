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

  it('解除すると TOTP を無効にする', async () => {
    mockFetchMFAPreference.mockResolvedValue({ enabled: ['TOTP'], preferred: 'TOTP' });
    mockUpdateMFAPreference.mockResolvedValue(undefined);
    render(<MfaSettingsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('mfa-disable')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mfa-disable'));

    await waitFor(() => {
      expect(screen.getByTestId('mfa-disabled-view')).toBeInTheDocument();
    });
    expect(mockUpdateMFAPreference).toHaveBeenCalledWith({ totp: 'DISABLED' });
  });
});
