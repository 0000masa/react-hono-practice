# Drizzle マイグレーションガイド

このドキュメントでは、Drizzle ORM のマイグレーションの仕組み、`drizzle-kit push` と `drizzle-kit generate` + `migrate()` の違い、そしてこのプロジェクトの `migrate.ts` Lambda ハンドラーの動作を解説する。

---

## 1. マイグレーションとは

### データベースマイグレーションの役割

マイグレーションとは、データベースのスキーマ（テーブル構造）を**バージョン管理しながら段階的に変更する仕組み**。アプリケーションコードが Git で変更履歴を追跡するように、データベースのスキーマ変更も履歴として管理する。

マイグレーションがない場合、スキーマの変更は手動で SQL を実行するしかなく、以下の問題が発生する：

- どの環境にどの変更が適用済みか分からなくなる
- チームメンバー間で環境が食い違う
- 本番環境への適用が手作業になりミスが起きやすい

### マイグレーションファイルとは

マイグレーションファイルは、スキーマの変更内容を記述した SQL ファイル（またはコードファイル）。1 つのマイグレーションファイルが 1 つのスキーマ変更に対応する。

```
src/db/migrations/
├── 0000_create_users.sql       ← 最初のテーブル作成
├── 0001_create_qr_codes.sql    ← QRコードテーブル追加
├── 0002_add_status_column.sql  ← カラム追加
└── meta/
    └── _journal.json           ← どのマイグレーションを適用済みかの管理ファイル
```

マイグレーションツールは「どこまで適用したか」をデータベース内のテーブル（Drizzle の場合は `__drizzle_migrations`）に記録する。新しいマイグレーションファイルが追加されると、未適用のファイルだけを順番に実行する。

---

## 2. Drizzle の 2 つのスキーマ適用方法

Drizzle ORM にはスキーマをデータベースに反映する方法が 2 つある。

### drizzle-kit push（開発用）

```bash
npx drizzle-kit push
```

**動作**: TypeScript のスキーマ定義（`src/db/schema.ts`）と現在のデータベースの状態を**直接比較**し、差分を即座にデータベースに適用する。

```
schema.ts（TypeScript）
        ↓ 直接比較
データベースの現在の状態
        ↓ 差分を SQL で適用
データベース更新完了
```

**特徴:**

- マイグレーションファイルを生成しない
- 即座にスキーマ変更が反映される
- 変更履歴が残らない
- ロールバック（元に戻す）ができない

**このプロジェクトでの使用箇所:**

`docker-compose.yml` の hono サービス起動コマンド：

```yaml
command:
  - /bin/bash
  - -c
  - |
    npm ci
    npx drizzle-kit push    ← ここで使っている
    npm run dev
```

ローカル開発では、コンテナ起動のたびに `drizzle-kit push` で `schema.ts` の定義をデータベースに同期している。開発中はスキーマを頻繁に変更するため、マイグレーションファイルを毎回生成するのは手間がかかる。`push` なら `schema.ts` を編集してコンテナを再起動するだけでよい。

### drizzle-kit generate + migrate()（本番用）

```bash
# ステップ 1: マイグレーションファイルを生成
npx drizzle-kit generate

# ステップ 2: マイグレーションファイルを実行（アプリケーションコードから）
migrate(db, { migrationsFolder: './src/db/migrations' })
```

**動作**: 2 段階のプロセスで行う。

```
ステップ 1: generate
  schema.ts（TypeScript）
          ↓ 比較（前回の generate 時点との差分）
  SQL マイグレーションファイルを生成（src/db/migrations/ に出力）

ステップ 2: migrate()
  マイグレーションファイル（SQL）
          ↓ 未適用のものだけ順番に実行
  データベース更新完了
          ↓ 適用済みを記録
  __drizzle_migrations テーブルに記録
```

**特徴:**

- マイグレーションファイルが Git にコミットされ、変更履歴が残る
- どの環境にどの変更が適用済みか追跡できる
- 全環境（ステージング・本番）で同じ SQL が実行される
- SQL ファイルを事前にレビューできる

### 2 つの方法の比較

| | `drizzle-kit push` | `drizzle-kit generate` + `migrate()` |
|---|---|---|
| マイグレーションファイル | 生成しない | 生成する |
| 変更履歴 | 残らない | Git で管理 |
| 適用方法 | CLI から直接 | アプリケーションコードから |
| ロールバック | 不可 | 可能（手動で逆の SQL を書く） |
| 用途 | ローカル開発 | ステージング・本番環境 |
| 安全性 | 低い（即座に変更される） | 高い（レビュー可能） |

### なぜ本番では push を使わないのか

`drizzle-kit push` は「現在のスキーマ定義」と「データベースの状態」を比較して差分を適用する。一見便利だが、本番環境では以下のリスクがある：

1. **既存データの破壊**: カラムの型変更やテーブル名変更を自動検出した場合、Drizzle が `DROP COLUMN` → `ADD COLUMN` のような破壊的な SQL を生成することがある。マイグレーションファイルなら事前に SQL を確認できる
2. **再現性がない**: 「いつ、どんな変更が適用されたか」の記録が残らない。障害時に原因を追跡できない
3. **環境間の一貫性**: ステージングと本番で同じ SQL ファイルを使うことで、「ステージングでは動いたのに本番では動かない」を防げる

---

## 3. drizzle-kit generate の仕組み

### 実行方法

```bash
cd backend
npx drizzle-kit generate
```

### 何が起きるか

1. `drizzle.config.ts` の `schema` フィールドから TypeScript スキーマファイルを読み込む
2. 前回の `generate` 時点のスナップショット（`migrations/meta/` に保存）と現在の `schema.ts` を比較する
3. 差分を SQL ファイルとして `migrations/` ディレクトリに出力する

### drizzle.config.ts の設定

```typescript
// backend/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',     // スキーマ定義ファイル
  out: './src/db/migrations',       // マイグレーションファイル出力先
  dialect: 'mysql',                 // データベース種別
  dbCredentials: {                  // push 時の接続先（generate では不要）
    host: process.env.DATABASE_HOST ?? 'mysql',
    port: parseInt(process.env.DATABASE_PORT ?? '3306', 10),
    database: process.env.DATABASE_NAME ?? 'database',
    user: process.env.DATABASE_USER ?? 'user',
    password: process.env.DATABASE_PASSWORD ?? 'password',
  },
});
```

`generate` は**データベースに接続しない**。TypeScript のスキーマ定義ファイルだけを読み取り、前回との差分を算出する。`dbCredentials` は `push` や `pull` コマンドでのみ使われる。

### 生成されるファイル

初回の `generate` を実行すると、以下のようなファイルが生成される：

```
src/db/migrations/
├── 0000_puzzling_wolverine.sql    ← Drizzle が自動で名前を付ける
└── meta/
    ├── 0000_snapshot.json         ← この時点のスキーマのスナップショット
    └── _journal.json              ← マイグレーション履歴の管理ファイル
```

SQL ファイルの中身（例）：

```sql
CREATE TABLE `users` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  ...
  CONSTRAINT `users_id` PRIMARY KEY(`id`),
  CONSTRAINT `users_email_unique` UNIQUE(`email`)
);

CREATE TABLE `qr_codes` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  ...
);
```

2 回目以降の `generate` では、前回のスナップショットと `schema.ts` の差分だけが新しい SQL ファイルとして生成される。

### meta/_journal.json の役割

`_journal.json` は「どのマイグレーションファイルが存在するか」を記録したインデックスファイル。`migrate()` はこのファイルを読んでマイグレーションの一覧と順序を把握する。

```json
{
  "entries": [
    {
      "idx": 0,
      "tag": "0000_puzzling_wolverine",
      "when": 1710000000000
    },
    {
      "idx": 1,
      "tag": "0001_add_status_column",
      "when": 1710100000000
    }
  ]
}
```

---

## 4. migrate() の仕組み

### コード上での呼び出し

```typescript
import { migrate } from 'drizzle-orm/mysql2/migrator';

await migrate(db, { migrationsFolder: '/path/to/migrations' });
```

### 実行の流れ

1. `migrationsFolder` 内の `meta/_journal.json` を読み込み、マイグレーションファイルの一覧を取得する
2. データベースの `__drizzle_migrations` テーブルを確認し、どのマイグレーションが適用済みかを取得する
   - このテーブルが存在しない場合は自動で作成する
3. 未適用のマイグレーション SQL ファイルを**番号順に**実行する
4. 各マイグレーションの適用が成功したら `__drizzle_migrations` テーブルに記録する

```
migrationsFolder/
├── 0000_create_tables.sql     ← 適用済み（__drizzle_migrations に記録あり）
├── 0001_add_column.sql        ← 未適用 → 今回実行する
└── meta/_journal.json

__drizzle_migrations テーブル:
| hash       | created_at          |
|------------|---------------------|
| 0000_xxx   | 2024-01-01 00:00:00 |
↑ 0000 は適用済み、0001 は未適用なので 0001 を実行する
```

### migrate() が SQL ファイルを必要とする理由

`migrate()` は `schema.ts` を読まない。SQL ファイルだけを読んで実行する。これが `push` との根本的な違い。

```
push:    schema.ts → DB の状態と比較 → 差分 SQL を生成・実行
migrate: SQL ファイル → 未適用のものを順番に実行
```

つまり、`drizzle-kit generate` で SQL ファイルを生成せずに `migrate()` を呼んでも、実行する SQL がないため**何もしない**。

---

## 5. このプロジェクトの migrate.ts

### コード

```typescript
// backend/src/migrate.ts
import path from 'node:path';
import { initDatabase, db } from './config/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';

const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;

  const migrationsFolder = path.join(__dirname, 'db', 'migrations');
  await migrate(db, { migrationsFolder });

  console.log('Migration completed successfully');
  return { statusCode: 200, body: 'Migration completed' };
};
```

### 処理の流れ

1. `initDatabase()` で RDS Proxy に IAM 認証で接続する（Lambda 環境）
2. `__dirname`（= Lambda の `/var/task`）を基点に `db/migrations` ディレクトリのパスを構築する
3. `migrate(db, { migrationsFolder })` でマイグレーションを実行する
4. 結果を返す

### __dirname のパス解決

esbuild で `src/migrate.ts` をバンドルすると、出力は `dist/migrate.js` という単一ファイルになる。Lambda コンテナ内では以下のように配置される：

```
/var/task/
├── migrate.js           ← esbuild のバンドル出力
└── db/
    └── migrations/      ← Dockerfile で別途コピー
        ├── 0000_xxx.sql
        └── meta/
            └── _journal.json
```

esbuild は `--platform=node --bundle` でデフォルトで CommonJS 形式（`require` / `module.exports`）を出力する。CommonJS では `__dirname` が使用可能で、バンドルされた `migrate.js` が `/var/task/` に配置されるため、`__dirname` は `/var/task` になる。

よって `path.join(__dirname, 'db', 'migrations')` は `/var/task/db/migrations` に解決される。

### マイグレーションファイルが esbuild でバンドルされない理由

esbuild は JavaScript / TypeScript の `import` / `require` を再帰的にたどってバンドルする。しかしマイグレーションファイル（`.sql`）は TypeScript コードから `import` されていない。`migrate()` は実行時に `fs.readFileSync()` でファイルシステムから直接読み込む。

```
esbuild がバンドルするもの:
  migrate.ts → import database → import drizzle-orm → ...
  すべて JS/TS の import チェーンでたどれるコード

esbuild がバンドルしないもの:
  .sql ファイル（import されていないのでたどれない）
  meta/_journal.json（同上）
```

そのため、Dockerfile で**マイグレーションファイルを別途コピー**する必要がある：

```dockerfile
# バンドルされた JS ファイル
COPY --from=builder /build/dist/migrate.js ${LAMBDA_TASK_ROOT}/migrate.js

# マイグレーション SQL ファイル（esbuild ではバンドルされない）
COPY --from=builder /build/src/db/migrations/ ${LAMBDA_TASK_ROOT}/db/migrations/
```

---

## 6. マイグレーションの運用フロー

### スキーマ変更からデプロイまでの流れ

```
[1] スキーマ定義を変更
    backend/src/db/schema.ts を編集

        ↓

[2] ローカル開発で動作確認
    docker compose up で drizzle-kit push が実行され、
    ローカル DB に即座に反映される

        ↓

[3] マイグレーションファイルを生成
    cd backend
    npx drizzle-kit generate
    → src/db/migrations/ に SQL ファイルが生成される

        ↓

[4] 生成された SQL をレビュー・コミット
    git add src/db/migrations/
    git commit -m "Add migration for ..."

        ↓

[5] CI/CD でデプロイ
    Docker イメージがビルドされ、マイグレーションファイルが
    コンテナにコピーされる

        ↓

[6] マイグレーション Lambda を実行
    AWS コンソールまたは CLI から Lambda を手動実行:
    aws lambda invoke --function-name react-hono-practice-migration ...
    → migrate() が未適用の SQL を実行する

        ↓

[7] API Lambda が新しいスキーマでリクエストを処理
```

### 現在のプロジェクトの状態

現在 `src/db/migrations/` ディレクトリは空。これはローカル開発で `drizzle-kit push` のみを使ってきたため。`migrate.ts` Lambda を初めて使う前に、一度 `npx drizzle-kit generate` を実行して現在のスキーマ全体をマイグレーションファイルとして生成する必要がある。

```bash
cd backend
npx drizzle-kit generate
# → 0000_xxx.sql が生成される（現在の schema.ts の全テーブル定義）
```

この初回の SQL ファイルには `CREATE TABLE` 文が含まれる。既に本番 DB にテーブルが存在する場合、`migrate()` が `CREATE TABLE` を実行するとエラーになる可能性がある。その場合の対応方法は 2 つ：

1. **テーブルが存在しない新規環境**: そのまま `migrate()` を実行すればテーブルが作成される
2. **テーブルが既に存在する環境**: `__drizzle_migrations` テーブルに初回マイグレーションを「適用済み」として手動で挿入し、以降のマイグレーションから自動適用されるようにする

---

## 7. push と generate + migrate の使い分けまとめ

| 環境 | 方法 | 理由 |
|---|---|---|
| ローカル開発 | `drizzle-kit push` | スキーマを頻繁に変更するため、手軽さを優先 |
| ステージング | `migrate()` Lambda | 本番と同じフローで事前検証 |
| 本番 | `migrate()` Lambda | 安全性・再現性・履歴管理を優先 |

### 関連ファイル一覧

| ファイル | 役割 |
|---|---|
| `backend/src/db/schema.ts` | Drizzle スキーマ定義（テーブル構造の TypeScript 表現） |
| `backend/drizzle.config.ts` | drizzle-kit の設定（スキーマファイルパス、出力先、DB 接続情報） |
| `backend/src/db/migrations/` | マイグレーション SQL ファイルの格納先（`generate` で生成） |
| `backend/src/migrate.ts` | マイグレーション実行 Lambda のエントリポイント |
| `docker/ecr/lambda/backend/Dockerfile` | マイグレーションファイルを Lambda イメージにコピー |
| `terraform/modules/app-infrastructure/lambda.tf` | マイグレーション Lambda の Terraform 定義 |
| `docker-compose.yml` | ローカル開発で `drizzle-kit push` を実行 |
