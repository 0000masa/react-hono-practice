import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/mail', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../../config/mail';
import { sendMail } from '../mail.service';
import { env } from '../../config/env';

const mockedSendEmail = vi.mocked(sendEmail);

describe('sendMail', () => {
  beforeEach(() => {
    mockedSendEmail.mockResolvedValue(undefined);
  });

  it('sendEmail に from / to / subject を正しく渡す', async () => {
    await sendMail('to@example.com', '件名テスト', '本文テスト');

    expect(mockedSendEmail).toHaveBeenCalledOnce();
    const arg = mockedSendEmail.mock.calls[0][0];
    expect(arg.from).toBe(env.MAIL_FROM);
    expect(arg.to).toBe('to@example.com');
    expect(arg.subject).toBe('件名テスト');
  });

  it('HTML 本文にテンプレートのレイアウトと subject / body が埋め込まれる', async () => {
    await sendMail('to@example.com', 'Subject-A', 'Body-A');

    const arg = mockedSendEmail.mock.calls[0][0];
    expect(arg.html).toContain('<!DOCTYPE html>');
    expect(arg.html).toMatch(/<h2[^>]*>Subject-A<\/h2>/);
    expect(arg.html).toContain('Body-A');
  });

  it('sendEmail がエラーを投げたら呼び出し元へ伝播する', async () => {
    mockedSendEmail.mockRejectedValue(new Error('SMTP down'));

    await expect(sendMail('to@example.com', 's', 'b')).rejects.toThrow('SMTP down');
  });
});
