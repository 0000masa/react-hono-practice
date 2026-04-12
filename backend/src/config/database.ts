import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from './env';
import * as schema from '../db/schema';

// 開発環境: 通常のパスワード認証（同期的に初期化）
// 本番環境 (DATABASE_USE_IAM_AUTH=true): initDatabase() で非同期初期化が必要
let pool: mysql.Pool;
let db: MySql2Database<typeof schema> & { $client: mysql.Pool };

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
  console.log('[initDatabase] DATABASE_USE_IAM_AUTH:', env.DATABASE_USE_IAM_AUTH);
  console.log('[initDatabase] db already set:', !!db);
  if (db) return;

  const { Signer } = await import('@aws-sdk/rds-signer');
  console.log('[initDatabase] Signer imported successfully');
  const signer = new Signer({
    hostname: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USERNAME,
  });
  const token = await signer.getAuthToken();
  console.log('[initDatabase] token type:', typeof token, 'length:', token?.length);

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

  // デバッグ: プール接続テスト
  try {
    const [rows] = await pool.query('SELECT 1 AS test');
    console.log('[initDatabase] pool test query success:', rows);
  } catch (e) {
    console.error('[initDatabase] pool test query failed:', e instanceof Error ? e.message : e);
    // プール接続に失敗した場合、createConnection で直接試す
    try {
      const conn = await mysql.createConnection({
        host: env.DATABASE_HOST,
        port: env.DATABASE_PORT,
        database: env.DATABASE_NAME,
        user: env.DATABASE_USERNAME,
        password: token,
        ssl: { rejectUnauthorized: true },
      });
      const [rows2] = await conn.query('SELECT 1 AS test');
      console.log('[initDatabase] direct connection test success:', rows2);
      await conn.end();
    } catch (e2) {
      console.error('[initDatabase] direct connection also failed:', e2 instanceof Error ? e2.message : e2);
    }
  }

  db = drizzle(pool, { schema, mode: 'default' });
}

export { db, pool };
