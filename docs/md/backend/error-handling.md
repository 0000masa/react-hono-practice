# バックエンドのエラーハンドリング指針

本ドキュメントは `backend/src/` のエラーハンドリング設計と、新規ハンドラ・ライブラリ追加時の書き方ルールを定める。CloudWatch 側のインフラ設計 (subscription filter / SES 通知 Lambda) については [cloudwatch-error-monitoring-guide.md](../aws/cloudwatch-error-monitoring-guide.md) を参照。

## 動機

過去には以下の問題があった:

- `controller` で `console.error` を直接呼び、エラー情報が JSON 化されずに CloudWatch に残っていた
- `return c.json({ error: '...' }, 500)` のように Response を直接返していて `app.onError` に到達せず、`logError` がスキップされていた
- Better Auth (`/api/auth/*`) が内部で catch + Response 組み立てするため throw されず、DB エラー等が SES 通知に乗らなかった

これらを **Hono 公式推奨の `HTTPException` パターン + `app.onError` 集中処理 + Better Auth の status 補完** で一本化し、CloudWatch subscription filter が拾える JSON ログを必ず出すようにした。

## アーキテクチャ全体図

```
                                         ┌──────────────────────────────┐
                                         │ app.ts: app.onError          │
                                         │  (HTTPException || throw)    │
  controller / middleware                │                              │
  ┌──────────────────────┐               │  if (HTTPException) {        │
  │ throw new            │ ─── err ─────▶│    if (status >= 500)        │
  │   HTTPException(...) │               │      logError('ERROR', ...)  │
  └──────────────────────┘               │    return err.getResponse()  │
                                         │  } else {                    │
  ┌──────────────────────┐               │    logError('ERROR', ...)    │
  │ Better Auth ルート   │               │    return c.json(500)        │
  │  res = handler(req)  │               │  }                           │
  │  if (res.status>=500)│ ─ JSONログ ─▶ │                              │
  │    logError(...)     │               └──────────────┬───────────────┘
  │  return res          │                              │
  └──────────────────────┘                              ▼
                                              ┌──────────────────────┐
                                              │ logger.ts: logError  │
                                              │  console.error(      │
                                              │    JSON.stringify({  │
                                              │      level: 'ERROR', │
                                              │      source: 'api',  │
                                              │      error, context, │
                                              │      ...             │
                                              │    })                │
                                              │  )                   │
                                              └──────────┬───────────┘
                                                         │ stderr
                                                         ▼
                                              ┌──────────────────────┐
                                              │ CloudWatch Logs      │
                                              │ (共有 LG: app_log)   │
                                              └──────────┬───────────┘
                                                         │ subscription filter
                                                         │ { $.level = "ERROR"
                                                         │   || $.level = "CRITICAL" }
                                                         ▼
                                              ┌──────────────────────┐
                                              │ notifications-email  │
                                              │ Lambda → SES         │
                                              └──────────────────────┘
```

## 書き方ルール

### ルール 1: 通常のエラーは `throw new HTTPException(...)`

```typescript
import { HTTPException } from 'hono/http-exception';

// 認証失敗
throw new HTTPException(401, { message: '認証が必要です' });

// リソース未存在
throw new HTTPException(404, { message: 'QRコードが見つかりません' });

// 内部エラー (元の error も渡す)
try {
  await sendMail(...);
} catch (error) {
  throw new HTTPException(500, {
    message: 'メールの送信に失敗しました',
    cause: error,  // ← onError でこれを logError の error 引数に渡す
  });
}
```

**ポイント**: `cause` に元の `Error` オブジェクトを必ず渡す。これで `app.onError` 側でスタックトレース付きの JSON ログが出る。

### ルール 2: 構造化ボディを返したい場合は `res:` オプション

バリデーションエラーのように、`{ error, messages: { field: [...] } }` の構造を返したいケース:

```typescript
if (Object.keys(errors).length > 0) {
  throw new HTTPException(422, {
    res: c.json({ error: 'バリデーションエラー', messages: errors }, 422),
  });
}
```

HTTPException は `res` が指定されていればそれをそのままレスポンスに使う。`message` だけだと `{ message: ... }` 形式の単純なレスポンスになるので、複雑なボディが必要なときは `res:` を使う。

### ルール 3: fire-and-forget の非同期処理は `logError` 直接呼び

`(async () => { ... })()` のような呼び出し元が結果を待たない非同期処理では、throw しても誰にも届かない:

```typescript
(async () => {
  try {
    await generateAndUpload(...);
    await db.update(...).set({ status: 'completed' });
  } catch (error) {
    // throw しても呼び出し元には届かない。logError 直接呼ぶ。
    logError('ERROR', 'api', 'Async QR code generation failed', error, {
      qrCodeId: result.id,
    });
    await db.update(...).set({ status: 'failed' });
  }
})();
```

呼び出し元の Hono ハンドラは既に正常終了 (202 Accepted) しているので、エラーは別経路で記録する必要がある。

### ルール 4: Hono の外 (Lambda エントリ) は `logError` 直接呼び

`sqs-handler.ts` / `db-task.ts` / `daily-report.ts` / `notifications-email.ts` は Hono のリクエストハンドラではなく、Lambda が直接呼び出すエントリポイント。`app.onError` の網はかかっていない:

```typescript
export const handler = async (event: SQSEvent) => {
  try {
    // ...
  } catch (error) {
    logError('ERROR', 'sqs-handler', 'SQS message processing failed', error, {
      messageId: record.messageId,
    });
    throw error; // SQS にリトライさせる場合は throw、握り潰すなら throw しない
  }
};
```

### ルール 5: ライブラリが throw しないケースは status 補完

Better Auth は内部で catch + Response 組み立てするため、Hono の `app.onError` には到達しない。例外的に **ルートハンドラで自前で status を見て logError を呼ぶ**:

```typescript
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const res = await getAuth().handler(c.req.raw);
  if (res.status >= 500) {
    logError('ERROR', 'api', `Better Auth returned ${res.status}`, undefined, {
      path: c.req.path,
      method: c.req.method,
      status: res.status,
    });
  }
  return res;
});
```

これは「ライブラリの設計上 throw されない」という制約を逃れるための補完で、Hono のベストプラクティスから外れているわけではない。同様の挙動の他ライブラリを使う場合も同じパターンを適用する。

## 4xx と 5xx の振り分け

| ステータス | logError 呼び出し | SES 通知 | 理由 |
|---|---|---|---|
| 2xx | × | × | 正常 |
| 4xx (401, 404, 422 等) | × | × | クライアント側の問題。通常運用で頻発するため通知しない |
| 5xx (500, 502 等) | ✓ | ✓ | サーバ側の不具合。即対応が必要 |

`app.onError` 内のロジックで:

```typescript
if (err instanceof HTTPException) {
  if (err.status >= 500) {
    logError(...); // ← 5xx だけ
  }
  return err.getResponse(); // ← 4xx でもレスポンスは返す
}
```

`HTTPException` でない unknown error (バグ等) は無条件に `logError` する (これは status 500 相当のサーバ不具合)。

## logger.ts のフィールド規約

```json
{
  "level": "ERROR" | "CRITICAL",
  "source": "api" | "sqs-handler" | "db-task" | "daily-report" | "notifications-email",
  "message": "短い説明文",
  "error": {
    "name": "DrizzleQueryError",
    "message": "Failed query: ...",
    "stack": "..."
  },
  "context": {
    "path": "/api/...",
    "method": "POST",
    "status": 500
  },
  "timestamp": "2026-05-18T09:02:41.071Z"
}
```

- `level`: `ERROR` は通常のサーバエラー、`CRITICAL` はサービス停止級 (DB マイグレーション失敗等)
- `source`: 呼び出し元 Lambda 種別。新規 Lambda を追加したら `LogSource` 型に追加する
- `context`: 自由形式。`path` `method` `status` 等のリクエスト情報や、業務識別子 (qrCodeId 等) を入れる

## CloudWatch との関係

CloudWatch Logs subscription filter は以下のパターンで JSON ログをフィルタする:

```
{ $.level = "ERROR" || $.level = "CRITICAL" }
```

つまり **JSON 1 行で `level` フィールドが `ERROR` か `CRITICAL` のときのみ** SES 通知 Lambda に流される。

- `console.log(...)` の素テキスト → マッチしない (通知されない)
- `console.error(...)` の素テキスト → マッチしない (通知されない)
- `logError(...)` が出す JSON → マッチする (通知される)

したがって、CloudWatch から SES 通知を発火させたいエラーは **必ず `logError` 経由で JSON 出力する** こと。

詳細は [cloudwatch-error-monitoring-guide.md](../aws/cloudwatch-error-monitoring-guide.md) を参照。

## 新規追加時のチェックリスト

### 新しいエンドポイントを追加するとき

- [ ] バリデーション失敗・認証失敗・リソース未存在は `throw new HTTPException(4xx, ...)` で表現する
- [ ] 構造化ボディが必要なら `res: c.json({...}, status)` オプションを使う
- [ ] try-catch で 5xx を返す場合は `throw new HTTPException(500, { message, cause: error })` で必ず `cause` に元のエラーを渡す
- [ ] `console.error` を直接書かない (`logError` 経由か `HTTPException` 経由)
- [ ] `return c.json({error}, 500)` を書かない (throw でなく return する形だと `onError` をスキップする)

### 新しい Lambda エントリを追加するとき

- [ ] `utils/logger.ts` の `LogSource` 型に新しい source 名 ('foo-task' 等) を追加する
- [ ] top-level の `handler` 関数全体を try-catch で囲み、catch で `logError(...)` を呼ぶ
- [ ] エラー時に Lambda 自体を失敗扱いにしたい (リトライ・DLQ 行き) 場合は logError 後に `throw error`、握り潰したい場合は throw しない
- [ ] CloudWatch ロググループは Terraform 側で `aws_lambda_function.logging_config` に共有 LG (`app_log`) を指定する (`terraform/modules/app-infrastructure/lambda.tf` 参照)

### 新しい外部ライブラリのルートを統合するとき

- [ ] そのライブラリが **throw する** タイプか、**Response を return する** タイプかを確認
- [ ] return するタイプ (Better Auth 等) なら、Hono ルートハンドラで `res.status >= 500` を見て自前で `logError` を呼ぶ補完を入れる
- [ ] そのライブラリが内部で `console.error` を直接呼ぶ場合、その素テキストは subscription filter に拾われない点を認識する (通知に乗せたいなら status 補完が必須)

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `backend/src/utils/logger.ts` | `logError` の本体、`LogLevel` / `LogSource` 型定義 |
| `backend/src/app.ts` | `app.onError` 集中処理、Better Auth ルート補完 |
| `backend/src/middleware/auth.ts` | 認証ミドルウェア (401 を HTTPException で throw) |
| `backend/src/controllers/*.controller.ts` | 各 controller の HTTPException 化サンプル |
| `terraform/modules/app-infrastructure/cloudwatch.tf` | subscription filter の `filter_pattern` 定義 |
| `terraform/modules/app-infrastructure/lambda.tf` | 各 Lambda の `logging_config.log_group` 指定 |
