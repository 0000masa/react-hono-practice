import path from 'node:path';
import { initDatabase, db, pool } from './config/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { logError } from './utils/logger';
import { seeders } from './db/seeds';

// モジュール読み込み時に DB 接続を開始する（Lambda のコールドスタート最適化）
// IAM 認証トークンの取得と RDS Proxy への接続を行う
const dbReady = initDatabase();

// 1 つの Lambda で migrate / seed / 任意 SQL を切り替えて実行する。
// 任意 SQL の権限境界は GitHub Actions の environment (required reviewers) で担保しており、
// Lambda 側では payload を信頼してそのまま実行する。
type DbTaskEvent =
  | { operation?: 'migrate' }
  | { operation: 'seed'; files?: string[] }
  | { operation: 'sql'; sql: string };

export const handler = async (event: DbTaskEvent = {}) => {
  const operation = event.operation ?? 'migrate';

  try {
    await dbReady;

    if (event.operation === undefined || event.operation === 'migrate') {
      // path.join() は OS のパス区切り文字でパス断片を結合する。
      // esbuild は --platform=node --bundle でデフォルト CJS を出力するため __dirname が使える。
      // バンドルされた db-task.js は /var/task/ に配置されるので __dirname は /var/task。
      // マイグレーション SQL は esbuild のバンドル対象外（import されていない）なので、
      // Dockerfile で別途 /var/task/db/migrations/ にコピーしている。
      const migrationsFolder = path.join(__dirname, 'db', 'migrations');

      // migrate() の手順:
      // 1. migrationsFolder の meta/_journal.json から SQL ファイル一覧を取得
      // 2. __drizzle_migrations テーブルで適用済みを確認（無ければ自動作成）
      // 3. 未適用の SQL を番号順に実行
      // 4. 適用記録を __drizzle_migrations に書く
      await migrate(db, { migrationsFolder });

      console.log('Migration completed successfully');
      return {
        statusCode: 200,
        body: JSON.stringify({ operation, message: 'Migration completed' }),
      };
    }

    if (event.operation === 'seed') {
      const registered = Object.keys(seeders);
      const requested = event.files ?? registered;

      const unknown = requested.filter((name: string) => !registered.includes(name));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown seeder files: ${unknown.join(', ')}. Registered: ${registered.join(', ')}`,
        );
      }

      // 登録順を維持して実行（payload で並びを差し替えられないようにするのは意図的）
      const ordered = registered.filter((name) => requested.includes(name));
      for (const name of ordered) {
        await seeders[name](db);
      }

      console.log(`Seed completed: ${ordered.join(', ')}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ operation, executed: ordered }),
      };
    }

    if (event.operation === 'sql') {
      if (!event.sql) {
        throw new Error('sql is required when operation is "sql"');
      }
      // pool は multipleStatements: false のままなので 1 文限定。
      const [result] = await pool.query(event.sql);
      console.log('SQL executed successfully');
      return {
        statusCode: 200,
        body: JSON.stringify({ operation, result }),
      };
    }

    throw new Error(`Unknown operation: ${(event as { operation?: unknown }).operation}`);
  } catch (error) {
    // DB タスク失敗は呼び出し元（デプロイパイプライン等）にも失敗を伝えるため再 throw する。
    logError('CRITICAL', 'db-task', `${operation} failed`, error, { operation });
    throw error;
  }
};
