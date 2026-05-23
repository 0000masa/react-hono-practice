# Lambda と esbuild ガイド

このドキュメントでは、esbuild によるバンドル、Lambda ハンドラーの仕組み、ビルドからデプロイまでの全体像を解説する。

---

## 1. esbuild とは（バンドルとは何か）

### esbuild の役割

esbuild は高速な JavaScript / TypeScript のバンドラー兼トランスパイラー。主に以下の 2 つを行う：

1. **トランスパイル**: TypeScript → JavaScript に変換する
2. **バンドル**: エントリファイルから `import` を再帰的にたどり、すべての依存コードを **1 つの .js ファイル** にまとめる

### なぜバンドルが必要か

Lambda のコンテナイメージ内には `node_modules` を丸ごとコピーしない。代わりに esbuild で必要なコードだけを 1 ファイルにまとめることで：

- イメージサイズを削減できる
- コールドスタート（Lambda の初回起動）が速くなる
- デプロイが単純になる（.js ファイル 1 つをコピーするだけ）

### build:lambda コマンドの解説

現在の `backend/package.json` に定義されているビルドスクリプト：

```bash
tsc --noEmit && esbuild src/lambda.ts --bundle --platform=node --outfile=dist/lambda.js --target=node22 --external:@aws-sdk/*
```

| フラグ | 意味 |
|---|---|
| `src/lambda.ts` | エントリポイント（ビルドの起点となるファイル） |
| `--bundle` | import を再帰的にたどり、依存コードをすべて 1 ファイルにまとめる |
| `--platform=node` | Node.js 向けにビルドする（ブラウザ向けではない） |
| `--outfile=dist/lambda.js` | 出力先ファイルパス |
| `--target=node22` | Node.js 22 の構文に合わせてコードを生成する |
| `--external:@aws-sdk/*` | `@aws-sdk/*` パッケージをバンドルに含めず外部依存のままにする |

### --external:@aws-sdk/* の理由

AWS Lambda の Node.js ランタイム（ベースイメージ `public.ecr.aws/lambda/nodejs:22`）には AWS SDK v3 がプリインストールされている。そのため `@aws-sdk/*` をバンドルに含める必要がなく、除外することでファイルサイズを削減できる。

### esbuild は型チェックをしない

esbuild は TypeScript の型アノテーションを**単純に削除**して JavaScript に変換するだけで、型の整合性は一切検証しない。これが esbuild の高速さの理由の一つだが、型エラーがあってもビルドが成功してしまうという注意点がある。

#### 他のビルドツールとの比較

| ツール | 型チェック | 仕組み |
|---|---|---|
| **esbuild** | しない | 型を削除するだけ。高速だが型エラーを検出できない |
| **tsc**（TypeScript コンパイラ） | する | `npx tsc --noEmit` で型チェックのみ実行可能 |
| **Vite** | しない（ビルド時） | 内部で esbuild を使って TypeScript を変換している |
| **Next.js** | する（ビルド時） | `next build` 時に内部で `tsc` を実行している |

#### Vite のプロジェクトでの型チェック

Vite 自体は型チェックをしないが、`npm create vite@latest` で作成されるプロジェクトの `package.json` には以下のような build スクリプトが生成される：

```json
"build": "tsc -b && vite build"
```

これは 2 つのコマンドを `&&` で繋いでいる：

1. **`tsc -b`**: TypeScript コンパイラで型チェックを行う（`-b` はプロジェクト参照を使ったビルドモード）
2. **`vite build`**: Vite（内部で esbuild）がバンドルを行う

`&&` は「前のコマンドが成功した場合のみ次を実行する」という意味なので、`tsc -b` で型エラーが見つかると `vite build` は実行されない。つまり Vite のテンプレートは**型チェックは tsc に任せ、バンドルは esbuild（Vite 経由）に任せる**という役割分担をしている。

このプロジェクトのフロントエンド（`frontend/package.json`）も同じ構成：

```json
"build": "tsc -b && vite build"
```

#### バックエンド（esbuild 単体）での型チェック

Vite プロジェクトの `build` スクリプトと同様に、バックエンドの `build:lambda` でも `tsc --noEmit &&` を先頭に付けて型チェックとバンドルをセットで実行するようにしている：

```json
"build:lambda": "tsc --noEmit && esbuild src/lambda.ts --bundle --platform=node --outfile=dist/lambda.js --target=node22 --external:@aws-sdk/*"
```

`&&` により型エラーがあれば esbuild は実行されない。`--noEmit` は「型チェックだけ行い JavaScript ファイルは出力しない」というフラグで、JavaScript の出力は esbuild に任せる。

ビルドスクリプトに型チェックを含めることで、ローカルでも CI でも `npm run build:lambda` を実行するだけで型安全が保証される。

#### tsc -b と tsc --noEmit の違い

Vite プロジェクトの `tsc -b` と CI の `npx tsc --noEmit` はどちらも型チェックを行うが、オプションの意味が異なる。

- **`-b`（`--build`）**: プロジェクト参照（`tsconfig.json` の `references`）を考慮したビルドモード。型チェック**と** JavaScript ファイルの出力を行う。ただし Vite テンプレートの `tsconfig.json` では `noEmit: true` が設定されているため、結果的に型チェックのみになっている。
- **`--noEmit`**: 型チェックだけ行い、JavaScript ファイルを一切出力しないという明示的な指定。

| | `tsc -b` | `tsc --noEmit` |
|---|---|---|
| 型チェック | する | する |
| JS 出力 | する（`noEmit: true` が tsconfig にあれば出力しない） | しない（フラグで明示的に抑制） |
| プロジェクト参照 | 対応 | 非対応 |
| 用途 | 複数 tsconfig がある場合（Vite テンプレートは `tsconfig.app.json` と `tsconfig.node.json` に分かれている） | 単一 tsconfig のプロジェクトでシンプルに型チェックしたい場合 |

バックエンドは `tsconfig.json` が 1 つだけなので `tsc --noEmit` で十分。

#### npx の役割

Vite プロジェクトの build スクリプトには `npx` がないが、CI の型チェックには `npx tsc --noEmit` と書いている。この違いは**実行場所**による。

`npx` はパッケージを探して実行するコマンド。`npm run` 経由（`package.json` の scripts 内）では npm が自動的に `node_modules/.bin/` を `PATH` に追加するため、`tsc` とだけ書けば見つかる。一方、GitHub Actions の `run` はただのシェルコマンドなので `node_modules/.bin/` が `PATH` に含まれておらず、`npx` で探す必要がある。

| 実行場所 | `node_modules/.bin/` への PATH | `npx` |
|---|---|---|
| `npm run` 内（package.json の scripts） | 自動で通る | 不要 |
| シェルから直接（CI の `run` など） | 通らない | 必要 |

#### PATH（パスが通る）とは

シェルで `tsc` と入力すると、OS は `PATH` 環境変数に登録されたディレクトリを順番に探し、`tsc` という実行ファイルが見つかったらそれを実行する。見つからなければ `command not found` になる。

```bash
# PATH の中身（コロン区切りでディレクトリが並んでいる）
echo $PATH
# /usr/local/bin:/usr/bin:/bin:...
```

「パスが通る」= `PATH` にそのコマンドがあるディレクトリが含まれている、という意味。

```
通常のシェル:
  PATH = /usr/local/bin:/usr/bin:/bin
  → tsc が見つからない（command not found）

npm run 経由:
  PATH = ./node_modules/.bin:/usr/local/bin:/usr/bin:/bin
  → node_modules/.bin/tsc が見つかる
```

`npm install` でパッケージをインストールすると、そのパッケージの CLI コマンドが `node_modules/.bin/` にシンボリックリンク（ファイルのショートカット）として配置される。シンボリックリンクはファイルのコピーではなく参照で、実行すると OS が自動的にリンク先の実体ファイルを実行する。

```
node_modules/.bin/
├── tsc       → ../typescript/bin/tsc      （実体へのリンク）
├── esbuild   → ../esbuild/bin/esbuild
├── tsx       → ../tsx/dist/cli.mjs
└── vite      → ../vite/bin/vite.js
```

こうすることで `node_modules/.bin/` だけ見れば、インストール済みのすべてのコマンドが揃っている状態になる。

---

## 2. Lambda ハンドラーとは

### ハンドラーの定義

Lambda ハンドラーとは、**Lambda ランタイムが呼び出す関数**のこと。Lambda が起動されると、ランタイムはハンドラーとして指定された関数を呼び出し、イベントデータを引数として渡す。

```typescript
export const handler = async (event: any, context: any) => {
  // event: Lambda を起動したトリガーからのデータ
  //   - API Gateway の場合: HTTP リクエスト情報
  //   - SQS の場合: キューのメッセージ
  //   - EventBridge の場合: スケジュールイベント
  // context: Lambda の実行環境情報（残り時間、メモリなど）
  return response;
};
```

### 現在の lambda.ts の解説

```typescript
// backend/src/lambda.ts
import { handle } from 'hono/aws-lambda';    // Hono の Lambda アダプター
import { initDatabase } from './config/database'; // DB 接続の初期化
import app from './app';                          // Hono アプリケーション

const dbReady = initDatabase();      // モジュール読み込み時に DB 接続を開始
const lambdaHandler = handle(app);   // Hono アプリを Lambda 用にラップ

export const handler = async (event: any, context: any) => {
  await dbReady;                     // DB 接続完了を待つ
  return lambdaHandler(event, context); // Hono に処理を委譲
};
```

### handle(app) と lambdaHandler の仕組み

`handle()` は**関数を返す関数**である。`handle(app)` を呼ぶと、`app` を内部に閉じ込めた新しい関数が返される。

```typescript
// hono/aws-lambda の handle() が内部的にやっていること（簡略化）
function handle(app) {
  // 「event と context を受け取る関数」を返す
  return async (event, context) => {
    const request = eventToRequest(event);     // Lambda の event を HTTP リクエストに変換
    const response = await app.fetch(request); // Hono アプリに処理させる
    return responseToResult(response);         // HTTP レスポンスを Lambda の戻り値形式に変換
  };
}
```

つまり `const lambdaHandler = handle(app)` を実行した時点で、`lambdaHandler` には `async (event, context) => { ... }` という関数が代入されている。

JavaScript / TypeScript では関数は値（オブジェクト）なので、変数に代入したり、戻り値として返したりできる：

```typescript
// 同じ原理の身近な例
function createGreeter(prefix: string) {
  return (name: string) => `${prefix}, ${name}!`;
}

const greet = createGreeter("こんにちは");
// greet には (name) => `こんにちは, ${name}!` が入っている
greet("太郎"); // "こんにちは, 太郎!"
```

### event と context の引数の流れ

`event` と `context` は**開発者が自分で値を入れるのではなく、Lambda ランタイムが自動的に渡す**もの。

- **`event`**: Lambda を起動したトリガーからのデータ。API Gateway 経由の場合：
  ```json
  {
    "httpMethod": "GET",
    "path": "/api/users",
    "headers": { "Authorization": "Bearer ..." },
    "body": null
  }
  ```
- **`context`**: Lambda の実行環境情報（残り実行時間、メモリ上限、リクエスト ID など）

引数が渡される流れは以下の通り：

```
Lambda ランタイムが handler(event, context) を呼ぶ
                         │         │
                         ▼         ▼
    lambdaHandler(event, context) を呼ぶ
         │
         ▼ （= handle(app) が返した関数が実行される）
         │
         ├── event を HTTP リクエストに変換
         ├── app.fetch(request) で Hono が処理
         └── レスポンスを Lambda 形式に変換して返す
```

`handler` → `lambdaHandler` への `event` / `context` の受け渡しはバケツリレーではなく、`lambdaHandler` が `(event, context) => { ... }` という関数そのものなので、**普通の関数呼び出し**である。

**処理の流れまとめ：**

1. Lambda ランタイムが `handler(event, context)` を呼び出す
2. `handler` 内で DB 接続の完了を待つ
3. `lambdaHandler(event, context)` を呼び出す（= `handle(app)` が返した関数）
4. その関数内で `event` を HTTP リクエストに変換する
5. Hono アプリ（ルーティング・ミドルウェア・コントローラー）が処理を行う
6. Hono のレスポンスを Lambda 形式に変換して返す

### ローカル開発との比較

同じ `app`（Hono アプリケーション）を異なるアダプターで動かしている：

| | ローカル開発 (`index.ts`) | Lambda (`lambda.ts`) |
|---|---|---|
| アダプター | `@hono/node-server` の `serve()` | `hono/aws-lambda` の `handle()` |
| 動作方式 | 常駐する HTTP サーバー | リクエストごとに関数が呼ばれる |
| 起動方法 | `tsx watch src/index.ts` | Lambda ランタイムが `handler` を呼び出す |
| ビルドコマンド | `npm run build`（`--packages=external`） | `npm run build:lambda`（`--external:@aws-sdk/*`） |

---

## 3. ビルド出力とハンドラーの関係

### ハンドラー文字列の読み方

Lambda の `image_config.command`（Terraform）や Dockerfile の `CMD` に指定する `["lambda.handler"]` は以下のように解釈される：

```
["lambda.handler"]
   │       │
   │       └── エクスポートされた関数名（export const handler）
   │
   └── ファイル名（LAMBDA_TASK_ROOT 内の lambda.js）
```

つまり Lambda ランタイムは次の手順でコードを実行する：

1. `LAMBDA_TASK_ROOT`（= `/var/task`）ディレクトリから `lambda.js` を読み込む
2. そのファイルの `handler` という名前のエクスポートを見つける
3. その関数を `event` と `context` を引数にして呼び出す

### esbuild の出力ファイル名との対応

esbuild の `--outfile` で指定したファイル名が、そのままハンドラー文字列のファイル名部分と一致する必要がある：

```
esbuild src/lambda.ts --outfile=dist/lambda.js
                                      │
Dockerfile: COPY dist/lambda.js → /var/task/lambda.js
                                            │
Terraform: image_config.command = ["lambda.handler"]
                                    │
                                    └── /var/task/lambda.js の handler を呼ぶ
```

---

## 4. 現在のビルドで含まれるファイルの範囲

`esbuild src/lambda.ts --bundle` を実行すると、`src/lambda.ts` を起点に `import` を再帰的にたどり、到達可能なすべてのコードが `dist/lambda.js` に含まれる。

```
src/lambda.ts
├── hono/aws-lambda          （node_modules からバンドルに含まれる）
├── ./config/database
│   ├── drizzle-orm           （バンドルに含まれる）
│   ├── mysql2                （バンドルに含まれる）
│   └── @aws-sdk/rds-signer   （external → バンドルに含まれない）
└── ./app
    ├── hono                  （バンドルに含まれる）
    ├── ./middleware/session
    └── ./routes/index
        ├── コントローラー群
        │   ├── サービス群
        │   │   ├── @aws-sdk/client-s3    （external → 含まれない）
        │   │   ├── @aws-sdk/client-ses   （external → 含まれない）
        │   │   ├── nodemailer            （バンドルに含まれる）
        │   │   └── qrcode               （バンドルに含まれる）
        │   └── DB スキーマ / 設定
        └── バリデーション（zod）
```

**ポイント:**
- `import` でたどれるすべてのコードが 1 つの `dist/lambda.js` にまとまる
- `@aws-sdk/*` だけは `--external` で除外されている（Lambda ランタイムにプリインストール済みのため）
- `import` でたどれないファイル（例: 別のエントリポイント用に書いた `sqs-handler.ts`）は含まれない

---

## 5. 新しいハンドラーの追加方法

### 現在の状況

Terraform の `lambda.tf` では 4 つの Lambda 関数が定義されているが、エントリポイントは `lambda.ts` しか存在しない：

| Lambda 関数 | Terraform の command | エントリファイル | ビルド出力 | 状態 |
|---|---|---|---|---|
| api | `["lambda.handler"]` | `src/lambda.ts` | `dist/lambda.js` | **作成済み** |
| sqs_worker | `["sqs-handler.handler"]` | `src/sqs-handler.ts` | `dist/sqs-handler.js` | 未作成 |
| migration | `["migrate.handler"]` | `src/migrate.ts` | `dist/migrate.js` | 未作成 |
| daily_report | `["daily-report.handler"]` | `src/daily-report.ts` | `dist/daily-report.js` | 未作成 |

### エントリファイルの作成

各 Lambda 関数ごとに、専用のエントリファイルを `backend/src/` に作成する。それぞれが独自の `handler` 関数をエクスポートする。

**SQS ワーカー（`src/sqs-handler.ts`）のスケルトン：**

```typescript
import { initDatabase } from './config/database';

const dbReady = initDatabase();

export const handler = async (event: any) => {
  await dbReady;

  // event.Records に SQS メッセージの配列が入っている
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    // QR コード生成処理...
  }

  return { statusCode: 200 };
};
```

**マイグレーション（`src/migrate.ts`）のスケルトン：**

```typescript
import { initDatabase } from './config/database';

const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;
  // Drizzle のマイグレーション実行処理...
  return { statusCode: 200, body: 'Migration completed' };
};
```

**日次レポート（`src/daily-report.ts`）のスケルトン：**

```typescript
import { initDatabase } from './config/database';

const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;
  // DB からデータ集計 → SES でメール送信...
  return { statusCode: 200, body: 'Report sent' };
};
```

### ビルドスクリプトの変更

複数のエントリポイントをビルドする場合、`--outfile`（単一ファイル出力）から `--outdir`（ディレクトリ出力）に変更する：

**変更前（単一エントリポイント）：**

```json
"build:lambda": "tsc --noEmit && esbuild src/lambda.ts --bundle --platform=node --outfile=dist/lambda.js --target=node22 --external:@aws-sdk/*"
```

**変更後（複数エントリポイント）：**

```json
"build:lambda": "tsc --noEmit && esbuild src/lambda.ts src/sqs-handler.ts src/migrate.ts src/daily-report.ts --bundle --platform=node --outdir=dist --target=node22 --external:@aws-sdk/*"
```

| 変更点 | 変更前 | 変更後 |
|---|---|---|
| エントリポイント | `src/lambda.ts` のみ | 4 ファイルを列挙 |
| 出力指定 | `--outfile=dist/lambda.js` | `--outdir=dist` |

`--outdir=dist` を指定すると、各エントリポイントのファイル名がそのまま出力ファイル名になる：

```
src/lambda.ts        → dist/lambda.js
src/sqs-handler.ts   → dist/sqs-handler.js
src/migrate.ts       → dist/migrate.js
src/daily-report.ts  → dist/daily-report.js
```

---

## 6. Dockerfile の変更

### 現在の Dockerfile

```dockerfile
FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build:lambda

FROM public.ecr.aws/lambda/nodejs:22
COPY --from=builder /build/dist/lambda.js ${LAMBDA_TASK_ROOT}/lambda.js
CMD ["lambda.handler"]
```

現在は `lambda.js` しかコピーしていないため、他の Lambda 関数（sqs-worker / migration / daily-report）は実行できない。

### 変更後の Dockerfile

すべてのハンドラーをコピーするように変更する：

```dockerfile
FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build:lambda

FROM public.ecr.aws/lambda/nodejs:22
COPY --from=builder /build/dist/lambda.js ${LAMBDA_TASK_ROOT}/lambda.js
COPY --from=builder /build/dist/sqs-handler.js ${LAMBDA_TASK_ROOT}/sqs-handler.js
COPY --from=builder /build/dist/migrate.js ${LAMBDA_TASK_ROOT}/migrate.js
COPY --from=builder /build/dist/daily-report.js ${LAMBDA_TASK_ROOT}/daily-report.js
CMD ["lambda.handler"]
```

これにより、1 つの Docker イメージに 4 つのハンドラーファイルが含まれる：

```
/var/task/
├── lambda.js          ← API 用
├── sqs-handler.js     ← SQS ワーカー用
├── migrate.js         ← マイグレーション用
└── daily-report.js    ← 日次レポート用
```

4 つの Lambda 関数はすべてこの同じイメージを使い、`image_config.command` でどのハンドラーを呼ぶかを切り替える。

---

## 7. Dockerfile の CMD と Terraform の image_config.command の関係

### CMD はデフォルト値

Dockerfile の `CMD ["lambda.handler"]` は「このイメージのデフォルトのハンドラー」を指定しているに過ぎない。

### image_config.command はオーバーライド

Terraform の `image_config.command` は、Lambda 関数の設定レベルで CMD を上書きする：

```hcl
# API Lambda → CMD をそのまま使う（同じ値を指定しているが、明示的に設定）
resource "aws_lambda_function" "api" {
  image_config {
    command = ["lambda.handler"]       # Dockerfile の CMD と同じ
  }
}

# SQS ワーカー → CMD を上書きして別のハンドラーを使う
resource "aws_lambda_function" "sqs_worker" {
  image_config {
    command = ["sqs-handler.handler"]  # Dockerfile の CMD を上書き
  }
}
```

### 優先順位

```
Terraform の image_config.command（指定あり） → こちらが使われる
                 ↓（指定なしの場合）
Dockerfile の CMD                             → フォールバックとして使われる
```

このプロジェクトでは 4 つの Lambda 関数すべてが `image_config.command` を明示的に指定しているため、Dockerfile の CMD は技術的には不要。ただし「このイメージのメインのハンドラーは `lambda.handler` である」というドキュメント的な役割として残しておくのが一般的。

---

## 8. まとめ：全体の流れ

### ビルド〜デプロイ〜実行の流れ

```
[1] ソースコード作成
    backend/src/lambda.ts
    backend/src/sqs-handler.ts
    backend/src/migrate.ts
    backend/src/daily-report.ts

        ↓ npm run build:lambda（tsc --noEmit → esbuild）

[2] バンドル出力
    backend/dist/lambda.js
    backend/dist/sqs-handler.js
    backend/dist/migrate.js
    backend/dist/daily-report.js

        ↓ docker build（Dockerfile）

[3] Docker イメージ作成
    /var/task/lambda.js
    /var/task/sqs-handler.js
    /var/task/migrate.js
    /var/task/daily-report.js

        ↓ docker push（GitHub Actions）

[4] ECR にプッシュ
    react-hono-practice-backend-lambda:sha-xxxxx

        ↓ Terraform が同じイメージを参照

[5] Lambda 関数（4 つとも同じイメージ、異なるハンドラー）
    ┌─────────────────┬──────────────────────────┬──────────────────────────┐
    │ Lambda 関数      │ command                  │ 実行される処理            │
    ├─────────────────┼──────────────────────────┼──────────────────────────┤
    │ api             │ ["lambda.handler"]       │ Hono API（HTTP リクエスト）│
    │ sqs_worker      │ ["sqs-handler.handler"]  │ QR コード非同期生成       │
    │ migration       │ ["migrate.handler"]      │ DB マイグレーション       │
    │ daily_report    │ ["daily-report.handler"] │ 日次レポートメール送信    │
    └─────────────────┴──────────────────────────┴──────────────────────────┘
```

### 関連ファイル一覧

| ファイル | 役割 |
|---|---|
| `backend/src/lambda.ts` | API ハンドラーのエントリポイント |
| `backend/src/sqs-handler.ts` | SQS ワーカーのエントリポイント（未作成） |
| `backend/src/migrate.ts` | マイグレーションのエントリポイント（未作成） |
| `backend/src/daily-report.ts` | 日次レポートのエントリポイント（未作成） |
| `backend/package.json` | esbuild ビルドスクリプトの定義 |
| `docker/ecr/lambda/backend/Dockerfile` | Lambda 用 Docker イメージの定義 |
| `terraform/modules/app-infrastructure/lambda.tf` | Lambda 関数の Terraform 定義 |
| `.github/workflows/deploy-backend-lambda.yml` | ECR へのビルド・プッシュの CI/CD |
