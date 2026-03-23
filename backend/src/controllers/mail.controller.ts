import type { Context } from 'hono';
import { sendMail } from '../services/mail.service';
import type { Env } from '../types/index';

export async function send(c: Context<Env>) {
  const body = await c.req.json<{ to?: string; subject?: string; message?: string }>();

  const errors: Record<string, string[]> = {};

  if (!body.to || typeof body.to !== 'string') {
    errors['to'] = ['to は必須です'];
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) {
    errors['to'] = ['有効なメールアドレスを入力してください'];
  }

  if (!body.subject || typeof body.subject !== 'string') {
    errors['subject'] = ['subject は必須です'];
  } else if (body.subject.length > 255) {
    errors['subject'] = ['subject は255文字以下で入力してください'];
  }

  if (!body.message || typeof body.message !== 'string') {
    errors['message'] = ['message は必須です'];
  } else if (body.message.length > 5000) {
    errors['message'] = ['message は5000文字以下で入力してください'];
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: 'バリデーションエラー', messages: errors }, 422);
  }

  try {
    await sendMail(body.to!, body.subject!, body.message!);
    return c.json({ message: 'メールを送信しました' });
  } catch (error) {
    console.error('Mail send error:', error);
    return c.json(
      {
        error: 'メールの送信に失敗しました',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
}
