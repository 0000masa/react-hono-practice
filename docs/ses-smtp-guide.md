# AWS SES SMTP メール送信ガイド

## SMTP とは

**SMTP（Simple Mail Transfer Protocol）** は、メールを送信するためのインターネット標準プロトコル。1982 年に RFC 821 で定義され、現在も世界中のメールサーバー間で使われている。

SMTP は「メールを送る」ためのプロトコルであり、「メールを受信する」プロトコル（POP3 / IMAP）とは別物。

### ポート番号

| ポート | 用途 | 暗号化 |
|--------|------|--------|
| 25 | サーバー間のメール転送（MTA 間） | なし（STARTTLS 可） |
| 587 | クライアントからの送信（推奨） | STARTTLS |
| 465 | クライアントからの送信（レガシー） | 暗黙的 TLS |

本プロジェクトでは **ポート 587 + STARTTLS** を使用する。STARTTLS とは、最初は平文で接続し、途中から TLS 暗号化に切り替える方式。

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

### どちらを選ぶべきか

- **SMTP がおすすめ**: ローカル開発で Mailpit を使いたい、AWS に強く依存したくない、Nodemailer を既に使っている
- **SDK がおすすめ**: Lambda で高頻度に送信する、IAM ロールで認証したい（アクセスキー管理を避けたい）、テンプレート機能を使いたい

本プロジェクトでは **開発環境で Mailpit、本番環境で SES SMTP** という構成のため、SMTP 方式が適している。

---

## SES SMTP 認証情報と IAM ユーザーの関係

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

### ステップ 2: SMTP 認証情報の作成

1. SES コンソール → 「SMTP 設定」
2. 「SMTP 認証情報の作成」をクリック
3. IAM ユーザー名を確認（デフォルトのままで OK）
4. 「作成」をクリック
5. **SMTP ユーザー名と SMTP パスワードが表示される**（この画面でしか確認できないのでメモする）

### ステップ 3: サンドボックスの解除（本番用）

デフォルトでは SES は「サンドボックスモード」で、検証済みのアドレスにしか送信できない。

1. SES コンソール → 「アカウントダッシュボード」
2. 「本番アクセスのリクエスト」をクリック
3. 送信上限、ユースケースなどを入力して申請
4. AWS の審査後（通常 24 時間以内）、任意のアドレスに送信可能になる

---

## Hono バックエンドでの設定

### 必要な環境変数

| 変数名 | 説明 | 開発環境 | 本番環境（SES SMTP） |
|--------|------|----------|---------------------|
| `SMTP_HOST` | SMTP ホスト | `mailpit` | `email-smtp.ap-northeast-1.amazonaws.com` |
| `SMTP_PORT` | SMTP ポート | `1025` | `587` |
| `SMTP_SECURE` | 暗黙的 TLS | `false` | `false`（STARTTLS なので） |
| `SMTP_USER` | SMTP ユーザー名 | （空 / 不要） | SES で作成した SMTP ユーザー名 |
| `SMTP_PASS` | SMTP パスワード | （空 / 不要） | SES で作成した SMTP パスワード |
| `MAIL_FROM` | 送信元アドレス | `noreply@example.com` | SES で検証済みのアドレス |

> **注意**: `SMTP_SECURE=false` でも通信は暗号化される。`SMTP_SECURE` は「接続開始時から TLS を使う（ポート 465）」かどうかのフラグ。ポート 587 では STARTTLS で途中から暗号化するため `false` で正しい。

### env.ts の設定例

```typescript
// 既存の SMTP 設定に追加
SMTP_HOST: getEnv('SMTP_HOST', 'mailpit'),
SMTP_PORT: parseInt(getEnv('SMTP_PORT', '1025'), 10),
SMTP_SECURE: getEnv('SMTP_SECURE', 'false') === 'true',
SMTP_USER: getEnv('SMTP_USER', ''),    // 追加
SMTP_PASS: getEnv('SMTP_PASS', ''),    // 追加
MAIL_FROM: getEnv('MAIL_FROM', 'noreply@example.com'),
```

### mail.ts の設定例

```typescript
import nodemailer from 'nodemailer';
import { env } from './env';

const auth = env.SMTP_USER
  ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
  : undefined;

export const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth,
});
```

開発環境（Mailpit）では `SMTP_USER` が空なので `auth: undefined` になり、認証なしで接続する。本番環境では SMTP 認証情報が使われる。

### 本番環境の .env 例

```bash
SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=AKIAXXXXXXXXXXXXXXXX
SMTP_PASS=BPuXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
MAIL_FROM=noreply@example.com
```

---

## SDK / SES API で送る場合との比較

参考として、SDK を使う場合のコード例も示す。

### SDK 方式のコード例

```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: 'ap-northeast-1' });

await ses.send(new SendEmailCommand({
  Source: 'noreply@example.com',
  Destination: { ToAddresses: ['user@example.com'] },
  Message: {
    Subject: { Data: '件名' },
    Body: { Html: { Data: '<p>本文</p>' } },
  },
}));
```

### 認証方式の違い

| 項目 | SMTP 方式 | SDK 方式 |
|------|----------|----------|
| **認証に必要なもの** | SMTP ユーザー名 + パスワード | IAM ロール or アクセスキー |
| **Lambda での認証** | 環境変数に SMTP 認証情報を設定 | IAM ロールが自動で使われる（設定不要） |
| **認証情報の管理** | SMTP パスワードを安全に保管する必要あり | IAM ロールなら認証情報の管理が不要 |
| **ローテーション** | IAM アクセスキーのローテーション時に SMTP パスワードも再生成 | IAM ロールなら自動 |

### まとめ: いつどちらを使うか

```
開発環境
  └─ Mailpit（ローカル SMTP サーバー）← SMTP 方式

本番環境（小〜中規模、Nodemailer 既存）
  └─ SES SMTP ← SMTP 方式（本プロジェクトはこちら）

本番環境（Lambda 大規模、AWS ネイティブ）
  └─ SES SDK ← SDK 方式
```

本プロジェクトでは開発/本番で同じ Nodemailer コードを使い、環境変数の切り替えだけで動作するため、SMTP 方式が最適。
