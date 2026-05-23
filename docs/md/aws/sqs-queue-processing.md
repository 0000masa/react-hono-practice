# SQS キュー処理（QR コード非同期生成）

このドキュメントでは、SQS キューを使った QR コード非同期生成の仕組み、処理フロー、関連ファイルの役割を解説する。

---

## 1. 概要

QR コード生成には画像の描画と S3 へのアップロードが含まれるため、同期処理では API のレスポンスが遅くなる。SQS キューを使い、リクエスト受付（API Lambda）と実際の生成処理（SQS Worker Lambda）を分離することで、クライアントに即座にレスポンスを返す。

---

## 2. 全体の処理フロー

```
クライアント
   │
   │ POST /api/qrcodes/async { data: "https://example.com" }
   ▼
API Lambda (lambda.ts)
   │
   │ 1. バリデーション
   │ 2. DB に status=pending で INSERT
   │ 3. SQS にメッセージ送信
   │ 4. 202 Accepted を返す
   ▼
SQS キュー (stg-qrcode-generation)
   │
   │ AWS が自動で Long Polling
   │ メッセージを検出すると Lambda を起動
   ▼
SQS Worker Lambda (sqs-handler.ts)
   │
   │ 1. メッセージから qrCodeId, data, userId を取得
   │ 2. QR コード画像を生成
   │ 3. S3 にアップロード
   │ 4. DB を status=completed に更新
   ▼
クライアント
   │
   │ GET /api/qrcodes/{id}/status でポーリング
   │ → status: "completed" になったら url を取得
   ▼
完了
```

---

## 3. 関連ファイルと役割

### API 側（リクエスト受付）

| ファイル | 役割 |
|---|---|
| `backend/src/controllers/qrcodes.controller.ts` | `storeAsync` 関数が SQS にメッセージを送信する。`status` 関数がポーリングに応答する |
| `backend/src/routes/qrcodes.ts` | `POST /async` と `GET /:id/status` のルート定義 |
| `backend/src/config/env.ts` | `SQS_QUEUE_URL` 環境変数の定義 |

### Worker 側（QR コード生成）

| ファイル | 役割 |
|---|---|
| `backend/src/sqs-handler.ts` | SQS Worker Lambda のエントリポイント。SQS イベントを受け取り QR コードを生成する |
| `backend/src/services/qrcode.service.ts` | `generateAndUpload()` — QR コード画像の生成と S3 アップロードを行う |
| `backend/src/services/storage.service.ts` | `uploadFile()` — S3 へのファイルアップロード |

### インフラ

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/sqs.tf` | SQS キューの作成 |
| `terraform/modules/app-infrastructure/lambda.tf` | SQS Worker Lambda の定義、SQS → Lambda のイベントソースマッピング |

---

## 4. 各ファイルの詳細

### qrcodes.controller.ts — storeAsync 関数

クライアントからのリクエストを受け付け、SQS にジョブを投入する。

```
storeAsync(c) の処理:
  1. リクエストボディの data フィールドをバリデーション
  2. DB に qr_codes レコードを INSERT（status: 'pending', fileName: ''）
  3. SQS にメッセージを送信（本番）またはローカルで直接処理（開発）
  4. 202 Accepted でレスポンスを返す
```

**SQS 送信部分のコード解説:**

```typescript
const sqsClient = env.SQS_QUEUE_URL ? new SQSClient({}) : null;
```

- `SQS_QUEUE_URL` が設定されている場合のみ SQS クライアントを作成する
- ローカル開発では空文字なので `null` になる
- `new SQSClient({})` は引数が空オブジェクトだが、Lambda 実行環境では IAM ロールの認証情報が自動で使われる

```typescript
if (sqsClient && env.SQS_QUEUE_URL) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        qrCodeId: result.id,  // DB に INSERT した ID
        data: body.data!,     // QR コードに埋め込むデータ
        userId: user.id,      // ファイル名生成に使う
      }),
    }),
  );
} else {
  // ローカル開発: fire-and-forget で直接処理
}
```

- 本番: SQS にメッセージを送信し、Worker Lambda が後から処理する
- ローカル: SQS がないので、即時非同期関数（IIFE）でその場で処理する

**SQS メッセージの内容:**

Worker Lambda がメッセージを受け取ったとき、QR コード生成に必要な情報がすべて含まれている必要がある。

```json
{
  "qrCodeId": 42,
  "data": "https://example.com",
  "userId": 1
}
```

| フィールド | 用途 |
|---|---|
| `qrCodeId` | 生成完了後に DB の該当レコードを更新するため |
| `data` | QR コード画像に埋め込むテキストデータ |
| `userId` | S3 のファイル名に含める（`{userId}_{timestamp}_{uniqId}.png`） |

### sqs-handler.ts — SQS Worker Lambda

SQS からメッセージを受け取り、QR コード生成を実行する Lambda のエントリポイント。

```
handler(event) の処理:
  1. DB 接続完了を待つ
  2. event.Records をループ（batch_size=1 なので通常 1 件）
  3. メッセージ body の JSON をパース
  4. generateAndUpload() で QR コード生成 + S3 アップロード
  5. DB を fileName + status='completed' に更新
  6. エラー時は status='failed' に更新
```

**event.Records のデータ構造:**

SQS → Lambda のイベントソースマッピングで Lambda が呼ばれると、`event` オブジェクトの `Records` 配列にメッセージが入る。各レコードの `body` プロパティに、`storeAsync` で送信した JSON 文字列が入っている。

```typescript
for (const record of event.Records) {
  const { qrCodeId, data, userId } = JSON.parse(record.body);
  // ...
}
```

**エラー時の挙動:**

```typescript
catch (error) {
  console.error(`QR code ${qrCodeId} generation failed:`, error);
  await db
    .update(qrCodes)
    .set({ status: 'failed' })
    .where(eq(qrCodes.id, qrCodeId));
}
```

エラーが発生しても `throw` せずに DB を `failed` に更新して正常終了する。正常終了すると SQS はメッセージを削除する。もし `throw` すると Lambda の実行が失敗扱いになり、SQS が `visibility_timeout`（90 秒）後にメッセージを再送するが、同じエラーが繰り返されるだけなので、DB に失敗を記録して終了する方が適切。

### qrcode.service.ts — generateAndUpload 関数

API Lambda の同期生成（`store`）と SQS Worker Lambda の非同期生成（`sqs-handler`）の両方から呼ばれる共通関数。

```
generateAndUpload(data, userId) の処理:
  1. qrcode ライブラリで PNG バッファを生成（300x300px）
  2. ファイル名を生成: {userId}_{UNIXタイムスタンプ}_{ランダム8文字}.png
  3. S3 にアップロード
  4. ファイル名を返す
```

### qrcodes.controller.ts — status 関数

クライアントがポーリングでステータスを確認するためのエンドポイント。

```
status(c) の処理:
  1. URL パラメータから id を取得
  2. DB から qr_codes レコードを検索
  3. status が 'completed' かつ fileName がある場合は url と file_name を付与して返す
```

---

## 5. SQS → Lambda の起動の仕組み

Terraform のイベントソースマッピングで SQS と Lambda が接続されている。

```hcl
resource "aws_lambda_event_source_mapping" "qrcode_worker" {
  event_source_arn = aws_sqs_queue.qrcode_generation.arn
  function_name    = aws_lambda_function.sqs_worker.arn
  batch_size       = 1
  enabled          = true
}
```

この設定により、以下の動作が AWS 側で自動的に行われる：

1. **AWS Lambda サービスのポーラー**が SQS キューに対して Long Polling を行う
2. メッセージが見つかると Worker Lambda を起動し、メッセージを `event.Records` として渡す
3. Lambda が正常終了すると、ポーラーがメッセージを SQS から自動削除する
4. Lambda がエラー終了すると、メッセージは `visibility_timeout`（90 秒）後に再びキューに戻る

ポーラーは AWS がマネージドで運用するため、利用者側でコンピュートリソースを用意する必要はない。メッセージがない間は Lambda は起動されず、実行課金も発生しない。

### batch_size の意味

`batch_size = 1` は、1 回の Lambda 呼び出しで渡すメッセージの最大数。1 なので常に 1 メッセージずつ処理する。

### timeout の関係

```
SQS visibility_timeout: 90 秒
Lambda timeout:          60 秒
```

Lambda の timeout は SQS の `visibility_timeout` より短くする必要がある。Lambda が処理中にタイムアウトした場合、メッセージは `visibility_timeout` 経過後にキューに戻り再処理される。もし Lambda の timeout が `visibility_timeout` より長いと、処理中なのにメッセージが別の Lambda に渡される二重処理が発生する。

---

## 6. ステータス遷移

```
pending → completed（正常）
pending → failed（エラー）
```

| ステータス | 設定タイミング | 設定箇所 |
|---|---|---|
| `pending` | API Lambda が DB に INSERT するとき | `qrcodes.controller.ts` の `storeAsync` |
| `completed` | Worker Lambda が QR 生成 + S3 アップロード成功後 | `sqs-handler.ts` |
| `failed` | Worker Lambda でエラーが発生したとき | `sqs-handler.ts` |

---

## 7. ローカル開発での動作

ローカル環境では SQS がないため、`SQS_QUEUE_URL` 環境変数が空になる。

```typescript
const sqsClient = env.SQS_QUEUE_URL ? new SQSClient({}) : null;
```

`sqsClient` が `null` のとき、`storeAsync` は SQS を使わず fire-and-forget パターンで直接 `generateAndUpload()` を呼ぶ。これにより、ローカル環境でも `POST /api/qrcodes/async` エンドポイントが動作する。

ローカルでは MinIO（S3 互換のオブジェクトストレージ）が docker-compose で起動しており、QR コード画像はそこに保存される。
