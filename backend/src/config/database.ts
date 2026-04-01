import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from './env';
import * as schema from '../db/schema';

// 開発環境: 通常のパスワード認証（同期的に初期化）
// 本番環境 (DATABASE_USE_IAM_AUTH=true): initDatabase() で非同期初期化が必要
let pool: mysql.Pool;
let db: ReturnType<typeof drizzle>;

if (!env.DATABASE_USE_IAM_AUTH) {
  pool = mysql.createPool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USERNAME,
    password: env.DATABASE_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
  });
  db = drizzle(pool, { schema, mode: 'default' });
}

/**
 * IAM 認証を使う場合の DB 初期化（Lambda 用）
 * RDS Proxy に IAM トークンで接続する。
 * 開発環境（IAM 認証無効）では即座に return する。
 */
export async function initDatabase() {
  if (db) return;

  const { Signer } = await import('@aws-sdk/rds-signer');
  const signer = new Signer({
    hostname: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USERNAME,
  });
  const token = await signer.getAuthToken();

  pool = mysql.createPool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USERNAME,
    password: token,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
  });
  db = drizzle(pool, { schema, mode: 'default' });
}

export { db, pool };
