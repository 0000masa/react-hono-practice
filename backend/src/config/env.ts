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

  GOOGLE_CLIENT_ID: getEnv('GOOGLE_CLIENT_ID', ''),
  GOOGLE_CLIENT_SECRET: getEnv('GOOGLE_CLIENT_SECRET', ''),
  GOOGLE_CALLBACK_URL: getEnv('GOOGLE_CALLBACK_URL', 'http://localhost:3000/api/auth/google/callback'),
  FRONTEND_URL: getEnv('FRONTEND_URL', 'http://localhost:5173'),

  SESSION_SECRET: getEnv('SESSION_SECRET', 'your-secret-key'),

  S3_ENDPOINT: getEnv('S3_ENDPOINT', 'http://minio:9000'),
  S3_BUCKET: getEnv('S3_BUCKET', 'qrcodes'),
  S3_REGION: getEnv('S3_REGION', 'us-east-1'),
  S3_ACCESS_KEY: getEnv('S3_ACCESS_KEY', 'minio_root'),
  S3_SECRET_KEY: getEnv('S3_SECRET_KEY', 'minio_password'),
  S3_FORCE_PATH_STYLE: getEnv('S3_FORCE_PATH_STYLE', 'true') === 'true',
  STORAGE_URL_BASE: getEnv('STORAGE_URL_BASE', 'http://localhost:9000/qrcodes'),

  SMTP_HOST: getEnv('SMTP_HOST', 'mailpit'),
  SMTP_PORT: parseInt(getEnv('SMTP_PORT', '1025'), 10),
  SMTP_SECURE: getEnv('SMTP_SECURE', 'false') === 'true',
  MAIL_FROM: getEnv('MAIL_FROM', 'noreply@example.com'),

  get isProduction() {
    return this.NODE_ENV === 'production';
  },
} as const;
