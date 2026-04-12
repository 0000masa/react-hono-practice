# 環境変数設定

## 環境変数一覧

### アプリケーション

| 変数名 | 説明 | デフォルト値 | 本番例 |
|--------|------|-------------|--------|
| `NODE_ENV` | 実行環境 | `development` | `production` |
| `PORT` | サーバーポート | `3000` | `3000` |

### データベース (MySQL)

| 変数名 | 説明 | デフォルト値 | 本番例 |
|--------|------|-------------|--------|
| `DATABASE_HOST` | DB ホスト | `mysql` | RDS エンドポイント |
| `DATABASE_PORT` | DB ポート | `3306` | `3306` |
| `DATABASE_NAME` | DB 名 | `database` | `production_db` |
| `DATABASE_USER` | DB ユーザー | `user` | `admin` |
| `DATABASE_PASSWORD` | DB パスワード | `password` | (Secrets Manager) |

### Google OAuth

| 変数名 | 説明 | デフォルト値 | 本番例 |
|--------|------|-------------|--------|
| `GOOGLE_CLIENT_ID` | クライアント ID | (空) | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | クライアントシークレット | (空) | (Secrets Manager) |
| `GOOGLE_CALLBACK_URL` | コールバック URL | `http://localhost:3000/api/auth/google/callback` | `https://api.example.com/api/auth/google/callback` |
| `FRONTEND_URL` | フロントエンド URL | `http://localhost:5173` | `https://example.com` |

### ストレージ (S3/MinIO)

| 変数名 | 説明 | デフォルト値 | 本番例 |
|--------|------|-------------|--------|
| `S3_ENDPOINT` | S3 エンドポイント | (空) | 未設定（AWS SDK がデフォルトで S3 に接続） |
| `S3_BUCKET` | バケット名 | `qrcodes` | `prod-qrcodes` |
| `S3_REGION` | リージョン | `us-east-1` | `ap-northeast-1` |
| `S3_ACCESS_KEY` | アクセスキー | (空) | 未設定（Lambda 実行ロールの IAM 認証を使用） |
| `S3_SECRET_KEY` | シークレットキー | (空) | 未設定（同上） |
| `S3_FORCE_PATH_STYLE` | パススタイル | `false` | `false` |
| `STORAGE_URL_BASE` | ファイル URL ベース | `http://localhost:9000/qrcodes` | `https://xxxx.cloudfront.net` |

### メール (SMTP)

| 変数名 | 説明 | デフォルト値 | 本番例 |
|--------|------|-------------|--------|
| `SMTP_HOST` | SMTP ホスト | `mailpit` | `email-smtp.ap-northeast-1.amazonaws.com` |
| `SMTP_PORT` | SMTP ポート | `1025` | `587` |
| `SMTP_SECURE` | TLS 使用 | `false` | `false` (STARTTLS) |
| `MAIL_FROM` | 送信元アドレス | `noreply@example.com` | `noreply@example.com` |

## Dev / Prod 切り替え

### 開発環境 (Docker Compose)

`.env` ファイルで設定。Docker Compose のサービス名 (`mysql`, `minio`, `mailpit`) がホスト名として使用されます。
S3 関連はデフォルト値が空のため、`.env` に MinIO 用の値を明示的に設定する必要があります（`.env.example` を参照）。

### 本番環境 (Lambda)

環境変数は Lambda の環境変数設定（Terraform）、または SSM Parameter Store で管理:

- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` は **未設定**（Lambda 実行ロールの IAM 認証 + S3 デフォルトエンドポイントを使用）
- `S3_FORCE_PATH_STYLE` は **未設定**（デフォルト `false` = AWS S3 の仮想ホスト形式）
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` は SSM Parameter Store から取得
- `GOOGLE_CALLBACK_URL` は CloudFront ドメイン経由（例: `https://www.favoritemyanime.com/api/auth/google/callback`）
- `STORAGE_URL_BASE` に CloudFront ドメインを設定
- `SMTP_HOST` に SES SMTP エンドポイントを設定
- Cookie に `secure: true` が自動設定 (`NODE_ENV=production`)
