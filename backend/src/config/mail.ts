import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';
import { env } from './env';

const sesClient = env.SES_REGION
  ? new SESClient({ region: env.SES_REGION })
  : null;

const smtpTransporter = !sesClient
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
    })
  : null;

interface SendMailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: SendMailOptions): Promise<void> {
  if (sesClient) {
    await sesClient.send(
      new SendEmailCommand({
        Source: options.from,
        Destination: { ToAddresses: [options.to] },
        Message: {
          Subject: { Data: options.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: options.html, Charset: 'UTF-8' } },
        },
      }),
    );
  } else {
    await smtpTransporter!.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }
}
