import { transporter } from '../config/mail.js';
import { env } from '../config/env.js';

export async function sendMail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8f9fa; border-radius: 8px; padding: 30px;">
        <h2 style="color: #333; margin-top: 0;">${subject}</h2>
        <div style="color: #555; line-height: 1.6;">${body}</div>
      </div>
      <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
        This email was sent from the application.
      </p>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    html,
  });
}
