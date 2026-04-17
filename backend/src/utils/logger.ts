export type LogLevel = 'ERROR' | 'CRITICAL';

export type LogSource = 'api' | 'sqs-handler' | 'migrate' | 'daily-report';

export type LogContext = Record<string, unknown>;

// 通知 Lambda (notifications-email.ts) がパースする JSON 1 行を stdout(err) に出す。
// CloudWatch Logs の subscription filter は 1 ログイベント = 1 行前提なので
// 複数行出力や pretty-print は禁止。
export function logError(
  level: LogLevel,
  source: LogSource,
  message: string,
  error: unknown,
  context: LogContext = {},
): void {
  const normalizedError =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'UnknownError', message: String(error) };

  const record = {
    level,
    source,
    message,
    error: normalizedError,
    context,
    timestamp: new Date().toISOString(),
  };

  console.error(JSON.stringify(record));
}
