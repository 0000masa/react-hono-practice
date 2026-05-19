import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

// vitest.integration.config.ts の env で DATABASE_* が注入された状態で呼ばれる前提。
// テスト用 MySQL に対してスキーマを初期化する。
export default async function setup() {
  const config = {
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DATABASE_PORT ?? '3307', 10),
    user: process.env.DATABASE_USERNAME ?? process.env.DATABASE_USER ?? 'user',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    database: process.env.DATABASE_NAME ?? 'app_test',
    multipleStatements: true,
  } as const;

  await waitForMySQL(config);

  const sql = readFileSync(resolve(__dirname, 'helpers/schema.sql'), 'utf-8');
  const conn = await mysql.createConnection(config);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(sql);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

async function waitForMySQL(config: mysql.ConnectionOptions): Promise<void> {
  const maxAttempts = 60;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const conn = await mysql.createConnection(config);
      await conn.ping();
      await conn.end();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Test MySQL was not ready: ${(lastErr as Error)?.message}`);
}
