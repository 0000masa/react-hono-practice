# 日次レポートバッチ処理

このドキュメントでは、EventBridge + Lambda で毎日自動実行される日次レポートバッチ処理の仕組み、処理フロー、関連ファイルの役割を解説する。

---

## 1. 概要

前日の QR コード生成アクティビティをユーザーごとに集計し、サマリーメールを SES で全ユーザーに送信するバッチ処理。EventBridge のスケジュールルールにより毎日 UTC 00:00（JST 09:00）に自動実行される。

---

## 2. 全体の処理フロー

```
EventBridge スケジュール (cron: 毎日 UTC 00:00)
   │
   │ Lambda を自動起動
   ▼
日次レポート Lambda (daily-report.ts)
   │
   │ 1. 前日の期間を JST ベースで算出
   │ 2. DB から前日の QR コード生成数をユーザーごとに集計
   │ 3. 全体サマリーを算出
   │ 4. 全ユーザーを DB から取得
   │ 5. 各ユーザーに個別メールを送信
   ▼
SES / SMTP
   │
   │ メール配信
   ▼
各ユーザーのメールボックス
```

---

## 3. 関連ファイルと役割

### アプリケーションコード

| ファイル | 役割 |
|---|---|
| `backend/src/daily-report.ts` | 日次レポート Lambda のエントリポイント。集計ロジックとメール送信を行う |
| `backend/src/services/mail.service.ts` | `sendMail()` — メール送信の共通関数。HTML テンプレートでラップして送信する |
| `backend/src/config/mail.ts` | SES クライアントまたは SMTP トランスポーターの初期化。`SES_REGION` が設定されていれば SES、なければ SMTP を使う |
| `backend/src/config/env.ts` | `SES_REGION`, `MAIL_FROM`, `ALERT_EMAIL_TO` 環境変数の定義 |
| `backend/src/db/schema.ts` | `users`, `qrCodes` テーブルのスキーマ定義 |

### インフラ

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/lambda.tf` | 日次レポート Lambda の定義、EventBridge → Lambda のパーミッション |
| `terraform/modules/app-infrastructure/eventbridge.tf` | EventBridge スケジュールルールの定義（該当する場合） |

---

## 4. daily-report.ts の処理詳細

### 4.1 DB 接続の初期化

```typescript
const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;
```

モジュール読み込み時に `initDatabase()` を呼び、RDS Proxy への接続を開始する。Lambda のコールドスタート最適化のため、ハンドラー関数の外で接続処理を開始し、ハンドラー内で完了を待つ。

### 4.2 前日の期間算出

```typescript
const now = new Date();
const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const jstYesterday = new Date(jstNow);
jstYesterday.setDate(jstYesterday.getDate() - 1);

const startOfDayJST = new Date(
  jstYesterday.getFullYear(),
  jstYesterday.getMonth(),
  jstYesterday.getDate(),
);
const endOfDayJST = new Date(
  jstYesterday.getFullYear(),
  jstYesterday.getMonth(),
  jstYesterday.getDate() + 1,
);

const startUTC = new Date(startOfDayJST.getTime() - 9 * 60 * 60 * 1000);
const endUTC = new Date(endOfDayJST.getTime() - 9 * 60 * 60 * 1000);
```

Lambda の実行環境のタイムゾーンは UTC。「前日」は日本時間（JST = UTC+9）ベースで算出する必要がある。

**計算の流れ（例: UTC 2026-04-06 00:00 に実行された場合）:**

| ステップ | 値 | 説明 |
|---|---|---|
| `now` | `2026-04-06T00:00:00Z` | 現在時刻（UTC） |
| `jstNow` | `2026-04-06T09:00:00Z`（※ Date 内部では UTC だが JST として扱う） | UTC に 9 時間加算 |
| `jstYesterday` | `2026-04-05T09:00:00Z` | JST の前日 |
| `startOfDayJST` | `2026-04-05T00:00:00Z`（JST の 0 時を表す） | 前日 JST 0:00 |
| `endOfDayJST` | `2026-04-06T00:00:00Z`（JST の翌 0 時を表す） | 当日 JST 0:00 |
| `startUTC` | `2026-04-04T15:00:00Z` | JST 0:00 → UTC に変換 |
| `endUTC` | `2026-04-05T15:00:00Z` | JST 翌 0:00 → UTC に変換 |

つまり、DB に対するクエリ条件は `created_at >= 2026-04-04T15:00:00Z AND created_at < 2026-04-05T15:00:00Z`（= JST 4/5 の丸一日）になる。

### 4.3 ユーザーごとの集計

```typescript
const perUserStats = await db
  .select({
    userId: qrCodes.userId,
    userName: users.name,
    userEmail: users.email,
    count: count(),
  })
  .from(qrCodes)
  .leftJoin(users, eq(qrCodes.userId, users.id))
  .where(and(gte(qrCodes.createdAt, startUTC), lt(qrCodes.createdAt, endUTC)))
  .groupBy(qrCodes.userId, users.name, users.email);
```

生成される SQL:

```sql
SELECT qr_codes.user_id, users.name, users.email, COUNT(*)
FROM qr_codes
LEFT JOIN users ON qr_codes.user_id = users.id
WHERE qr_codes.created_at >= '2026-04-04 15:00:00'
  AND qr_codes.created_at < '2026-04-05 15:00:00'
GROUP BY qr_codes.user_id, users.name, users.email
```

結果: 前日に QR コードを生成したユーザーの一覧と、それぞれの生成数が返る。QR コードを生成していないユーザーは結果に含まれない（`count` が 0 ではなく、行自体がない）。

### 4.4 全体サマリーの算出

```typescript
const totalQrCodes = perUserStats.reduce((sum, row) => sum + row.count, 0);
const activeUserCount = perUserStats.length;
const sortedStats = [...perUserStats].sort((a, b) => b.count - a.count);
const mostActive = sortedStats[0] ?? null;
```

| 変数 | 意味 |
|---|---|
| `totalQrCodes` | 前日の QR コード総生成数（全ユーザー合計） |
| `activeUserCount` | 前日に QR コードを生成したユーザーの数 |
| `mostActive` | 最も多く QR コードを生成したユーザー（名前と件数） |

### 4.5 全ユーザーの取得とメール送信

```typescript
const allUsers = await db.select().from(users);

const userCountMap = new Map(
  perUserStats.map((row) => [row.userId, row.count]),
);
```

`allUsers` は QR コードを生成したかどうかに関係なく全ユーザーを取得する。`userCountMap` は `userId → 生成数` の Map で、QR コードを生成していないユーザーは Map に含まれないため、`get()` の結果が `undefined` → `?? 0` で 0 件として扱う。

```typescript
for (const user of allUsers) {
  const userCount = userCountMap.get(user.id) ?? 0;

  const body = `
    <h3>${dateStr} のQRコード生成レポート</h3>
    <h4>あなたのアクティビティ</h4>
    <p>QRコード生成数: <strong>${userCount}件</strong></p>
    <h4>全体サマリー</h4>
    <ul>
      <li>総QRコード生成数: ${totalQrCodes}件</li>
      <li>アクティブユーザー数: ${activeUserCount} / ${allUsers.length}人</li>
      ${mostActive ? `<li>最もアクティブなユーザー: ${mostActive.userName} (${mostActive.count}件)</li>` : ''}
    </ul>
  `;

  try {
    await sendMail(user.email, subject, body);
  } catch (error) {
    console.error(`Failed to send daily report to ${user.email}:`, error);
  }
}
```

各ユーザーに個別のメールを送信する。メールの内容は：

- **あなたのアクティビティ**: そのユーザー自身の QR コード生成数（生成していなければ 0 件）
- **全体サマリー**: 全ユーザー共通の統計情報

`sendMail()` でエラーが発生しても `catch` してログに出力し、他のユーザーへの送信を続行する。1 ユーザーへの送信失敗で全体が止まらないようにしている。

### 4.6 sendMail の処理

`sendMail()` は `services/mail.service.ts` に定義された共通関数。

```typescript
export async function sendMail(to, subject, body) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="...">
      <div style="...">
        <h2>${subject}</h2>
        <div>${body}</div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({ from: env.MAIL_FROM, to, subject, html });
}
```

引数の `body`（HTML 断片）をメールテンプレートでラップし、`config/mail.ts` の `sendEmail()` に渡す。`sendEmail()` は `SES_REGION` 環境変数の有無で SES と SMTP を切り替える。

| 環境 | メール送信方法 | 設定 |
|---|---|---|
| 本番（Lambda） | AWS SES | `SES_REGION=ap-northeast-1` |
| ローカル（Docker） | SMTP（Mailpit） | `SMTP_HOST=mailpit`, `SMTP_PORT=1025` |

---

## 5. メールの内容

### 件名

```
【日次レポート】2026/04/05 QRコード生成サマリー
```

### 本文（HTML）

各ユーザーに送信されるメールの本文構成：

```
2026/04/05 のQRコード生成レポート

あなたのアクティビティ
  QRコード生成数: 3件      ← ユーザーごとに異なる

全体サマリー
  ・総QRコード生成数: 15件
  ・アクティブユーザー数: 4 / 10人
  ・最もアクティブなユーザー: 田中太郎 (7件)
```

---

## 6. EventBridge による自動実行

Terraform で定義された EventBridge ルールにより、毎日自動で Lambda が起動される。

```hcl
# スケジュール式: cron(0 0 * * ? *)
# 毎日 UTC 00:00（JST 09:00）に実行
```

EventBridge は Lambda を直接呼び出すプッシュ型のため、`aws_lambda_permission` で EventBridge からの呼び出しを許可する設定が必要。

```hcl
resource "aws_lambda_permission" "eventbridge_daily_report" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.daily_report.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_report.arn
}
```

---

## 7. Lambda の設定値

Terraform で定義された日次レポート Lambda の設定：

| 設定 | 値 | 理由 |
|---|---|---|
| `memory_size` | 512 MB | DB クエリとメール送信のみで大きなメモリは不要 |
| `timeout` | 300 秒（5 分） | ユーザー数が多い場合のメール送信に余裕を持たせる |
| `command` | `daily-report.handler` | `daily-report.js` の `handler` 関数を呼ぶ |

### 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_HOST` | RDS Proxy のエンドポイント |
| `DATABASE_USE_IAM_AUTH` | `true` — IAM 認証でDB接続 |
| `SES_REGION` | SES のリージョン（`ap-northeast-1`） |
| `MAIL_FROM` | 送信元メールアドレス |
| `ALERT_EMAIL_TO` | 管理者通知用メールアドレス（将来の拡張用） |

---

## 8. ローカルでの動作確認

ローカル環境で日次レポートの動作を確認するには、`daily-report.ts` の `handler` 関数を直接呼び出すスクリプトを作成するか、`tsx` で実行する。

```bash
# backend ディレクトリで
npx tsx -e "import { handler } from './src/daily-report'; handler().then(console.log)"
```

メールは Mailpit（`http://localhost:8025`）で確認できる。ただし、DB にユーザーと前日の QR コードデータが存在する必要がある。
