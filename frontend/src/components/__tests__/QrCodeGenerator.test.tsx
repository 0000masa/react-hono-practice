import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../../lib/api';
import QrCodeGenerator from '../QrCodeGenerator';

const mockedPost = vi.mocked(apiClient.post);

beforeEach(() => {
  mockedPost.mockReset();
});

describe('QrCodeGenerator', () => {
  it('正常系: テキスト入力 → 送信で apiClient.post が呼ばれ成功メッセージが表示される', async () => {
    mockedPost.mockResolvedValue({ data: { id: 1 }, status: 201, ok: true });
    const user = userEvent.setup();

    render(<QrCodeGenerator />);

    const textarea = screen.getByLabelText(/QRコードに含めるデータ/);
    await user.type(textarea, 'https://example.com');

    const button = screen.getByRole('button', { name: /QRコードを生成/ });
    await user.click(button);

    expect(mockedPost).toHaveBeenCalledWith('/qrcodes', { data: 'https://example.com' });
    expect(await screen.findByText('QRコードを生成しました')).toBeInTheDocument();
  });

  it('正常系: 成功時に `qrcode-created` カスタムイベントが発火される', async () => {
    mockedPost.mockResolvedValue({ data: {}, status: 201, ok: true });
    const handler = vi.fn();
    window.addEventListener('qrcode-created', handler);

    try {
      const user = userEvent.setup();
      render(<QrCodeGenerator />);

      await user.type(screen.getByLabelText(/QRコードに含めるデータ/), 'x');
      await user.click(screen.getByRole('button', { name: /QRコードを生成/ }));

      // post 完了を待つ
      await screen.findByText('QRコードを生成しました');
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('qrcode-created', handler);
    }
  });

  it('異常系: API がエラーを投げたらエラーメッセージが表示される', async () => {
    mockedPost.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();

    render(<QrCodeGenerator />);

    await user.type(screen.getByLabelText(/QRコードに含めるデータ/), 'data');
    await user.click(screen.getByRole('button', { name: /QRコードを生成/ }));

    expect(await screen.findByText('QRコードの生成に失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('QRコードを生成しました')).not.toBeInTheDocument();
  });

  it('異常系: 空欄ではボタンが disabled で API は呼ばれない', async () => {
    render(<QrCodeGenerator />);

    const button = screen.getByRole('button', { name: /QRコードを生成/ });
    expect(button).toBeDisabled();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
