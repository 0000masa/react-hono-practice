export type LogLevel = 'ERROR' | 'CRITICAL';

export type LogSource = 'api' | 'sqs-handler' | 'db-task' | 'daily-report';

export type LogContext = Record<string, unknown>;

// 通知 Lambda (notifications-email.ts) がパースする JSON 1 行を stderr に出す。
// CloudWatch Logs の subscription filter は 1 ログイベント = 1 行前提なので
// 複数行出力や pretty-print は禁止。
//
// なぜ console.log ではなく console.error を使うか:
//   - console.log は stdout (file descriptor 1)、console.error は stderr (FD 2) に書く。
//   - Lambda ランタイムはどちらも CloudWatch Logs に記録するため、subscription filter の
//     対象になるかどうかだけで見れば技術的にはどちらでも動く。
//   - ただし「エラーは stderr」という Unix 慣習に合わせておくと:
//       * ローカル実行時に stderr を赤字で表示する開発ツールが多く、視認性が上がる
//       * Datadog / Sentry 等の監視ツールが stderr をエラー扱いする実装が多い
//       * Lambda の Advanced Logging Controls (JSON 形式) を有効化すると
//         console.error は ERROR レベル、console.log は INFO レベルに自動分類される
//   - よって「エラー用ロガーは console.error で書く」を契約として固定する。
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
