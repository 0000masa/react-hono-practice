import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { gunzipSync } from 'node:zlib';

// CloudWatch Logs subscription filter が Lambda に渡す event 形式。
// awslogs.data は gzip 圧縮後 base64 エンコードされた JSON 文字列。
type CloudWatchLogsEvent = { awslogs: { data: string } };
type CloudWatchLogEvent = { id: string; timestamp: number; message: string };
type CloudWatchLogsDecoded = {
  logGroup?: string;
  logStream?: string;
  logEvents: CloudWatchLogEvent[];
};

// utils/logger.ts が出力する JSON 契約。
interface StructuredLog {
  level?: string;
  source?: string;
  message?: string;
  error?: { name?: string; message?: string; stack?: string };
  context?: Record<string, unknown>;
  timestamp?: string;
}

const SES_REGION = process.env.SES_REGION ?? 'ap-northeast-1';
const ses = new SESClient({ region: SES_REGION });

function decodeCwLogsEvent(event: CloudWatchLogsEvent): CloudWatchLogsDecoded {
  const compressed = Buffer.from(event.awslogs.data, 'base64');
  const decompressed = gunzipSync(compressed);
  return JSON.parse(decompressed.toString('utf-8'));
}

function tryParseJsonLog(message: string): StructuredLog | null {
  try {
    const obj = JSON.parse(message);
    return typeof obj === 'object' && obj !== null
      ? (obj as StructuredLog)
      : null;
  } catch {
    return null;
  }
}

function toJst(input: string | number | Date): string {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(input)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatEntry(
  parsed: StructuredLog | null,
  rawMessage: string,
): string {
  if (!parsed) return rawMessage;

  const ctx = parsed.context
    ? JSON.stringify(parsed.context, null, 2)
    : '(なし)';

  const lines = [
    `Level: ${parsed.level ?? '(不明)'}`,
    `Source: ${parsed.source ?? '(不明)'}`,
    `Message: ${parsed.message ?? '(なし)'}`,
    parsed.error?.message
      ? `Error: ${parsed.error.name ?? 'Error'}: ${parsed.error.message}`
      : null,
    parsed.error?.stack ? `Stack:\n${parsed.error.stack}` : null,
    `Context: ${ctx}`,
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

async function sendEmail(subject: string, body: string): Promise<void> {
  const toRaw = process.env.ALERT_EMAIL_TO;
  if (!toRaw) return;

  const toAddrs = toRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (toAddrs.length === 0) return;

  const fromAddr = process.env.ALERT_EMAIL_FROM;
  if (!fromAddr) {
    console.error('ALERT_EMAIL_FROM is not set; skipping SES send.');
    return;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: fromAddr,
        Destination: { ToAddresses: toAddrs },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
  } catch (e) {
    // SES 失敗でハンドラ全体を落とさない（Python 版の挙動踏襲）
    console.error('SES send failed:', e);
  }
}

export const handler = async (event: CloudWatchLogsEvent) => {
  const appEnv = process.env.APP_ENV ?? 'unknown';
  const decoded = decodeCwLogsEvent(event);

  const entries: string[] = [];
  let highestLevel: 'CRITICAL' | 'ERROR' | 'その他' = 'その他';
  let latestTs: number | undefined;

  for (const e of decoded.logEvents ?? []) {
    const parsed = tryParseJsonLog(e.message);
    entries.push(formatEntry(parsed, e.message.trimEnd()));

    if (parsed?.level === 'CRITICAL') {
      highestLevel = 'CRITICAL';
    } else if (parsed?.level === 'ERROR' && highestLevel !== 'CRITICAL') {
      highestLevel = 'ERROR';
    }
    latestTs = e.timestamp ?? latestTs;
  }

  if (entries.length === 0) {
    return { statusCode: 200, body: 'no logs' };
  }

  const occurredAt = toJst(latestTs ?? Date.now());
  const errorTypeLabel =
    highestLevel === 'CRITICAL'
      ? 'クリティカルエラー'
      : highestLevel === 'ERROR'
        ? '標準エラー'
        : 'その他のエラー';

  const MAX_CHARS = 3500;
  let errorText = entries.join('\n---\n');
  if (errorText.length > MAX_CHARS) {
    errorText = errorText.slice(0, MAX_CHARS) + '\n...(以下省略)';
  }

  const body = `【react-hono-practice - エラー報告】
エラーの種類: ${errorTypeLabel}
発生時間: ${occurredAt}
環境: ${appEnv}
対応: エラーの確認及び、対応をお願いいたします。
-----------------------------------------------------
Log Group: ${decoded.logGroup ?? '(不明)'}
Log Stream: ${decoded.logStream ?? '(不明)'}
-----------------------------------------------------
${errorText}
`;

  const subject = `【react-hono-practice - エラー報告】${appEnv} / ${errorTypeLabel} / ${occurredAt}`;
  await sendEmail(subject, body);

  return { statusCode: 200, body: '通知完了' };
};
