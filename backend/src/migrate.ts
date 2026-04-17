import path from 'node:path';
import { initDatabase, db } from './config/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { logError } from './utils/logger';

// モジュール読み込み時に DB 接続を開始する（Lambda のコールドスタート最適化）
// IAM 認証トークンの取得と RDS Proxy への接続を行う
const dbReady = initDatabase();

export const handler = async () => {
  try {
    // DB 接続完了を待つ（initDatabase() が既に完了していれば即座に返る）
    await dbReady;

    // path.join() は引数のパス断片を OS のパス区切り文字（Linux/Mac は '/'）で結合する。
    // 単純な文字列結合（`__dirname + '/db/migrations'`）と違い、
    // 余分な '/' の重複や '..' の解決を自動で行うため、安全にパスを構築できる。
    //
    // 例: path.join('/var/task', 'db', 'migrations') → '/var/task/db/migrations'
    //
    // esbuild は --platform=node --bundle でデフォルト CJS 形式を出力するため、
    // __dirname が使用可能。バンドルされた migrate.js が /var/task/ に配置されるので、
    // __dirname は /var/task になる。
    // マイグレーション SQL ファイルは esbuild のバンドル対象外（import されていないため）なので、
    // Dockerfile で別途 /var/task/db/migrations/ にコピーしている。
    const migrationsFolder = path.join(__dirname, 'db', 'migrations');

    // migrate() は以下の手順でマイグレーションを実行する：
    // 1. migrationsFolder 内の meta/_journal.json を読み込み、マイグレーションファイルの一覧を取得
    // 2. DB の __drizzle_migrations テーブルで適用済みのマイグレーションを確認（テーブルがなければ自動作成）
    // 3. 未適用の SQL ファイルを番号順に実行
    // 4. 適用したマイグレーションを __drizzle_migrations テーブルに記録
    await migrate(db, { migrationsFolder });

    console.log('Migration completed successfully');
    return { statusCode: 200, body: 'Migration completed' };
  } catch (error) {
    // マイグレーション失敗はデプロイ全体を止めるレベルなので CRITICAL 扱い。
    // Lambda の戻り値を失敗にして呼び出し元（デプロイパイプライン等）にも失敗を伝えるため再 throw する。
    logError('CRITICAL', 'migrate', 'Migration failed', error);
    throw error;
  }
};
