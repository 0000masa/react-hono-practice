# AWS SES メール送信ガイド

## 本プロジェクトの構成

本プロジェクトでは **SDK / SES API** を使ったやり方でメールを送信している。

- **開発環境**: Mailpit（Docker Compose のローカル SMTP サーバー）で Nodemailer 経由で送信
- **本番環境**: AWS SDK（`@aws-sdk/client-ses`）で SES API を直接呼び出して送信（Lambda + IAM ロール認証）

`SES_REGION` 環境変数が設定されていれば SES SDK、未設定なら Nodemailer SMTP という分岐で、同じコードが開発/本番の両方で動作する。

### メール送信処理のファイル一覧

| ファイル | 役割 |
|---------|------|
| `backend/src/config/mail.ts` | メール送信関数（SES SDK / Nodemailer の分岐ロジック） |
| `backend/src/services/mail.service.ts` | メール送信サービス（HTML テンプレート生成 + 送信関数の呼び出し） |
| `backend/src/controllers/mail.controller.ts` | メール送信 API エンドポイント（バリデーション + サービス呼び出し） |
| `terraform/modules/app-infrastructure/lambda.tf` | Lambda の SES 環境変数設定（`SES_REGION`, `MAIL_FROM`） |
| `terraform/modules/app-infrastructure/lambda-notification.tf` | エラー通知メール Lambda（Python / boto3 SES SDK） |

---

## SMTP とは

**SMTP（Simple Mail Transfer Protocol）** は、メールを送信するためのインターネット標準プロトコル。1982 年に RFC 821 で定義され、現在も世界中のメールサーバー間で使われている。

SMTP は「メールを送る」ためのプロトコルであり、「メールを受信する」プロトコル（POP3 / IMAP）とは別物。

### ポート番号

| ポート | 用途 | 暗号化 |
|--------|------|--------|
| 25 | サーバー間のメール転送（MTA 間） | なし（STARTTLS 可） |
| 587 | クライアントからの送信（推奨） | STARTTLS |
| 465 | クライアントからの送信（レガシー） | 暗黙的 TLS |

### STARTTLS とは

**STARTTLS** は、既に確立された平文の TCP 接続を途中から TLS 暗号化接続にアップグレードするための SMTP 拡張機能（RFC 3207）。

#### 通信の流れ

```
クライアント                          SMTP サーバー
    │                                    │
    │── TCP 接続（平文）──────────────→   │  ① まず平文で接続
    │                                    │
    │←─ 220 smtp.example.com Ready ────  │  ② サーバーが応答
    │                                    │
    │── EHLO client.example.com ───────→ │  ③ クライアントが挨拶
    │                                    │
    │←─ 250-STARTTLS ──────────────────  │  ④ サーバーが「STARTTLS 対応」と返答
    │                                    │
    │── STARTTLS ──────────────────────→ │  ⑤ クライアントが暗号化を要求
    │                                    │
    │←─ 220 Go ahead ─────────────────  │  ⑥ サーバーが了承
    │                                    │
    │══ TLS ハンドシェイク ════════════   │  ⑦ ここから暗号化通信に切り替わる
    │                                    │
    │── AUTH LOGIN（暗号化済み）────────→ │  ⑧ 認証情報を安全に送信
    │── MAIL FROM / RCPT TO / DATA ───→ │  ⑨ メールを送信
    │                                    │
```

#### 暗黙的 TLS（ポート 465）との違い

| 項目 | STARTTLS（ポート 587） | 暗黙的 TLS（ポート 465） |
|------|----------------------|------------------------|
| **接続開始** | 平文で接続し、途中から TLS に切替 | 最初から TLS で接続 |
| **暗号化のタイミング** | STARTTLS コマンドの後 | 接続直後 |
| **ポート** | 587（推奨） | 465（レガシー） |
| **Nodemailer の `secure`** | `false` | `true` |

> **なぜ `SMTP_SECURE=false` でも安全なのか**: `secure=false` は「最初から TLS を使わない」という意味であり、「暗号化しない」という意味ではない。ポート 587 では STARTTLS により途中から TLS に切り替わるため、認証情報やメール本文は暗号化された状態で送信される。

---

## SMTP でメールを送る仕組み

メール送信の全体的な流れは以下の通り。

```
┌──────────────┐    SMTP     ┌──────────────┐           ┌──────────────┐
│  Hono        │ ──────────→ │  SMTP サーバー │ ────────→ │  受信者の     │
│  (Nodemailer)│   認証+送信  │  (AWS SES)   │  メール転送 │  メールサーバー│
└──────────────┘             └──────────────┘           └──────────────┘
```

### ステップの詳細

1. **接続**: Nodemailer が SES の SMTP サーバー（`email-smtp.<region>.amazonaws.com:587`）に TCP 接続する
2. **STARTTLS**: 平文接続から TLS 暗号化接続にアップグレードする
3. **SMTP 認証**: ユーザー名とパスワードを送信して認証する（← ここで SMTP 認証情報が必要）
4. **メール送信**: `MAIL FROM`, `RCPT TO`, `DATA` コマンドでメールの送信元・宛先・本文を送る
5. **切断**: メールが受理されたら接続を閉じる

### SMTP 認証とは

SMTP 認証（SMTP AUTH）は、メール送信者が「自分は正当な送信者である」ことを証明する仕組み。認証なしだと誰でもメールを送れてしまうため、スパム防止のために必須。

SES の SMTP サーバーは認証なしの接続を拒否する。

---

## AWS SES の 2 つの送信方法

AWS SES でメールを送る方法は大きく 2 つある。

### 比較表

| 項目 | SMTP | SDK / SES API |
|------|------|---------------|
| **プロトコル** | SMTP（メール標準プロトコル） | HTTPS（AWS API） |
| **認証方式** | SMTP ユーザー名 + パスワード | IAM ロール or アクセスキー（署名 v4） |
| **必要なライブラリ** | Nodemailer（汎用 SMTP クライアント） | `@aws-sdk/client-ses`（AWS 専用） |
| **AWS への依存度** | 低い（SMTP は汎用プロトコル） | 高い（AWS SDK に依存） |
| **設定の手軽さ** | 環境変数 4〜5 個で完了 | IAM ロール/ポリシー設定が必要 |
| **Lambda との相性** | △（SMTP はステートフル接続） | ◎（HTTPS ベースで Lambda 向き） |
| **ローカル開発** | ◎（Mailpit 等の SMTP サーバーで代替可） | △（LocalStack 等が必要） |
| **送信速度** | やや遅い（TCP 接続 + TLS ハンドシェイク） | 速い（HTTP/2 対応） |
| **移植性** | 高い（SES 以外の SMTP にも切替可能） | 低い（AWS 専用コード） |

### 本プロジェクトの選択

本プロジェクトでは **SDK / SES API 方式**を本番環境で採用している。理由:

- **Lambda との相性が良い**: HTTPS ベースなので、Lambda のステートレスな実行モデルに適している
- **IAM ロールで認証**: Lambda に付与された IAM ロールが自動で使われるため、SMTP ユーザー名/パスワードの管理が不要
- **SMTP 認証情報のローテーション不要**: IAM ロールは自動で認証情報が更新される

一方、**開発環境では Mailpit（SMTP）** を使用している。理由:

- Docker Compose で手軽に起動できる
- 送信メールを Web UI（http://localhost:8025）で確認できる
- AWS アカウントや SES の設定が不要

```
開発環境
  └─ Mailpit（Docker Compose）← Nodemailer SMTP

本番環境（Lambda）
  └─ AWS SES ← SDK / SES API（本プロジェクトはこちら）
```

---

## SES SMTP 認証情報と IAM ユーザーの関係

> 本プロジェクトでは SDK/SES API 方式を使用しているため、この SMTP 認証情報は不要。SMTP 方式を使う場合のみ必要となる知識として記載する。

### 「SMTP 認証情報の作成」で何が起きるか

SES コンソールの「SMTP 設定」→「SMTP 認証情報の作成」ボタンを押すと、以下が自動的に行われる。

1. **IAM ユーザーが作成される**（例: `ses-smtp-user.20260403-123456`）
2. そのユーザーに **`ses:SendRawEmail` 権限を持つポリシー**がアタッチされる
3. そのユーザーの **IAM アクセスキー**が生成される
4. アクセスキーのシークレットキーから **SMTP パスワードが導出される**

つまり、「SMTP 認証情報の作成」= 「SES 送信権限付きの IAM ユーザーを作成してアクセスキーを発行する」ということ。

### アクセスキーと SMTP 認証情報の対応

| IAM 側 | SMTP 側 | 説明 |
|--------|---------|------|
| アクセスキー ID | SMTP ユーザー名 | そのまま使う |
| シークレットアクセスキー | SMTP パスワード | **変換アルゴリズムで導出**（元の値とは異なる） |

> **重要**: SMTP パスワードはシークレットアクセスキーそのものではない。AWS 独自のアルゴリズム（HMAC-SHA256 ベース）で変換された値。SES コンソールで認証情報を作成すると、変換済みの SMTP パスワードが表示される。

### なぜアクセスキーが必要なのか

SMTP は AWS 独自のプロトコルではなく、汎用的なメール送信プロトコル。SMTP の認証は「ユーザー名 + パスワード」で行われる。

一方、AWS のサービスは通常 IAM（アクセスキー + 署名 v4）で認証する。

この 2 つの認証方式を橋渡しするために、以下の仕組みになっている。

```
SMTP クライアント                AWS SES SMTP サーバー
(Nodemailer)                    (email-smtp.xxx.amazonaws.com)

  SMTP ユーザー名 ──────────→  アクセスキー ID として検証
  SMTP パスワード ──────────→  シークレットキーに逆変換して IAM 認証
```

つまり、SES の SMTP サーバーは裏側で **SMTP 認証を IAM 認証に変換している**。アクセスキーが必要なのは、この変換のため。

### どのタイミングで必要か

SMTP 認証情報が使われるタイミングは、**Nodemailer が SES の SMTP サーバーに接続する瞬間**。具体的には、`transporter.sendMail()` を呼んだとき。

```
sendMail() 呼び出し
  → TCP 接続（ポート 587）
  → STARTTLS
  → AUTH LOGIN（← ここで SMTP ユーザー名 + パスワードを送信）
  → MAIL FROM / RCPT TO / DATA
  → 送信完了
```

環境変数に設定しておけば、Nodemailer が自動的に認証を行う。

---

## AWS 側のセットアップ手順

### ステップ 1: ドメインまたはメールアドレスの検証

SES でメールを送るには、送信元のドメインまたはメールアドレスを検証する必要がある。

1. SES コンソール → 「検証済み ID」→「ID の作成」
2. ドメインの場合: DNS に DKIM レコード（CNAME × 3）を追加
3. メールアドレスの場合: 検証メール内のリンクをクリック

```
ドメイン検証の場合、以下の DNS レコードを追加:

xxxx._domainkey.example.com  CNAME  xxxx.dkim.amazonses.com
yyyy._domainkey.example.com  CNAME  yyyy.dkim.amazonses.com
zzzz._domainkey.example.com  CNAME  zzzz.dkim.amazonses.com
```

### ステップ 2: IAM ロールに SES 送信権限を付与（SDK 方式）

Lambda の実行ロールに `ses:SendEmail` と `ses:SendRawEmail` の権限を追加する。

```json
{
  "Effect": "Allow",
  "Action": [
    "ses:SendEmail",
    "ses:SendRawEmail"
  ],
  "Resource": "*"
}
```

本プロジェクトでは Terraform の Lambda 実行ロールモジュールでこの権限を管理している。

### ステップ 3: サンドボックスの解除（本番用）

デフォルトでは SES は「サンドボックスモード」で、検証済みのアドレスにしか送信できない。

1. SES コンソール → 「アカウントダッシュボード」
2. 「本番アクセスのリクエスト」をクリック
3. 送信上限、ユースケースなどを入力して申請
4. AWS の審査後（通常 24 時間以内）、任意のアドレスに送信可能になる

---

## Hono バックエンドでの設定

### 環境変数

| 変数名 | 説明 | 開発環境 | 本番環境（SES SDK） |
|--------|------|----------|---------------------|
| `SES_REGION` | SES リージョン | （空 = SMTP 使用） | `ap-northeast-1` |
| `MAIL_FROM` | 送信元アドレス | `noreply@example.com` | SES で検証済みのアドレス |
| `SMTP_HOST` | SMTP ホスト（開発用） | `mailpit` | （不要） |
| `SMTP_PORT` | SMTP ポート（開発用） | `1025` | （不要） |
| `SMTP_SECURE` | 暗黙的 TLS（開発用） | `false` | （不要） |

`SES_REGION` が設定されていれば SES SDK を使い、未設定なら Nodemailer SMTP を使う。

### mail.ts の実装

```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';
import { env } from './env';

// SES_REGION が設定されていれば SES SDK を使う
const sesClient = env.SES_REGION
  ? new SESClient({ region: env.SES_REGION })
  : null;

// SES SDK が使えない場合（開発環境）は Nodemailer SMTP
const smtpTransporter = !sesClient
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
    })
  : null;

export async function sendEmail(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (sesClient) {
    // 本番環境: SES SDK
    await sesClient.send(
      new SendEmailCommand({
        Source: options.from,
        Destination: { ToAddresses: [options.to] },
        Message: {
          Subject: { Data: options.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: options.html, Charset: 'UTF-8' } },
        },
      }),
    );
  } else {
    // 開発環境: Nodemailer SMTP（Mailpit）
    await smtpTransporter!.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }
}
```

### 本番環境の環境変数例（Lambda）

```bash
SES_REGION=ap-northeast-1
MAIL_FROM=noreply@mail.example.com
```

### 開発環境の環境変数例（.env）

```bash
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM=noreply@example.com
# SES_REGION は未設定 → Nodemailer SMTP が使われる
```

---

## SDK / SES API と SMTP 方式の認証の違い

| 項目 | SMTP 方式 | SDK / SES API 方式 |
|------|----------|-------------------|
| **認証に必要なもの** | SMTP ユーザー名 + パスワード | IAM ロール or アクセスキー |
| **Lambda での認証** | 環境変数に SMTP 認証情報を設定 | IAM ロールが自動で使われる（設定不要） |
| **認証情報の管理** | SMTP パスワードを安全に保管する必要あり | IAM ロールなら認証情報の管理が不要 |
| **ローテーション** | IAM アクセスキーのローテーション時に SMTP パスワードも再生成 | IAM ロールなら自動 |
| **セキュリティ** | SMTP パスワードの漏洩リスクあり | IAM ロールは一時的な認証情報を自動発行 |
