import dotenv from 'dotenv';

dotenv.config();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const env = {
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PORT: parseInt(getEnv('PORT', '3000'), 10),

  DATABASE_HOST: getEnv('DATABASE_HOST', 'mysql'),
  DATABASE_PORT: parseInt(getEnv('DATABASE_PORT', '3306'), 10),
  DATABASE_NAME: getEnv('DATABASE_NAME', 'database'),
  DATABASE_USERNAME: getEnv('DATABASE_USERNAME', process.env.DATABASE_USER ?? 'user'),
  DATABASE_PASSWORD: getEnv('DATABASE_PASSWORD', 'password'),
  DATABASE_USE_IAM_AUTH: getEnv('DATABASE_USE_IAM_AUTH', 'false') === 'true',

  BETTER_AUTH_SECRET: getEnv('BETTER_AUTH_SECRET', 'dev-secret-change-in-production'),
  GOOGLE_CLIENT_ID: getEnv('GOOGLE_CLIENT_ID', ''),
  GOOGLE_CLIENT_SECRET: getEnv('GOOGLE_CLIENT_SECRET', ''),
  FRONTEND_URL: getEnv('FRONTEND_URL', 'http://localhost:5173'),


  S3_ENDPOINT: getEnv('S3_ENDPOINT', ''),
  S3_BUCKET: getEnv('S3_BUCKET', 'qrcodes'),
  S3_REGION: getEnv('S3_REGION', 'us-east-1'),
  S3_ACCESS_KEY: getEnv('S3_ACCESS_KEY', ''),
  S3_SECRET_KEY: getEnv('S3_SECRET_KEY', ''),
  // S3 バケットURL の形式を切り替える設定
  // true（パス形式）:       https://endpoint/bucket-name/key   ← MinIO 等の S3 互換ストレージ用
  // false（仮想ホスト形式）: https://bucket-name.s3.region.amazonaws.com/key ← AWS S3（デフォルト・推奨）
  // MinIO は仮想ホスト形式（バケット名のサブドメイン解決）に対応していないため true が必要
  //
  // === 'true' で文字列を boolean に変換している理由:
  // getEnv() は常に文字列を返すため、そのまま代入すると文字列 'false' が入る。
  // JavaScript では空でない文字列は truthy なので、if ('false') は true になってしまう。
  // === 'true' と比較することで、環境変数が文字列 'true' のときだけ boolean true になる。
  S3_FORCE_PATH_STYLE: getEnv('S3_FORCE_PATH_STYLE', 'false') === 'true',
  STORAGE_URL_BASE: getEnv('STORAGE_URL_BASE', 'http://localhost:9000/qrcodes'),

  SES_REGION: getEnv('SES_REGION', ''),

  SMTP_HOST: getEnv('SMTP_HOST', 'mailpit'),
  SMTP_PORT: parseInt(getEnv('SMTP_PORT', '1025'), 10),
  SMTP_SECURE: getEnv('SMTP_SECURE', 'false') === 'true',
  MAIL_FROM: getEnv('MAIL_FROM', 'noreply@example.com'),

  SQS_QUEUE_URL: getEnv('SQS_QUEUE_URL', ''),
  ALERT_EMAIL_TO: getEnv('ALERT_EMAIL_TO', ''),

  get isProduction() {
    return this.NODE_ENV === 'production';
  },
} as const;
