# QR Code Manager - React + Hono Practice

AWS サーバーレス構成と React + Hono を使ったフルスタック Web アプリケーションの学習・練習プロジェクトです。

QR コード生成・管理アプリを題材に、以下の技術要素を実践的に学んでいます。

- Google OAuth 認証（BetterAuth）
- 非同期ジョブ処理（SQS）
- オブジェクトストレージ（S3）と CDN 配信（CloudFront）
- メール送信（SES）
- スケジュールバッチ処理（EventBridge + Lambda）
- Infrastructure as Code（Terraform）

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フロントエンド | React 19, Vite, TypeScript, Tailwind CSS, React Router v6 |
| バックエンド | Hono, TypeScript, Drizzle ORM, Zod, BetterAuth |
| データベース | MySQL 8.0 |
| インフラ | Terraform, AWS (CloudFront, API Gateway, Lambda, RDS + RDS Proxy, S3, SQS, EventBridge, SES, WAF, Secrets Manager, SSM Parameter Store, SNS, CloudWatch, Route 53, ACM) |
| ローカル開発 | Docker Compose (MySQL, MinIO, Mailpit) |
| CI/CD | GitHub Actions |

## アーキテクチャ

### ローカル開発環境

Docker Compose で 5 つのサービスを起動します。

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  React   │────▶│  Hono    │────▶│  MySQL   │
│ (Vite)   │     │  API     │     │          │
│ :5173    │     │  :3000   │     │  :3306   │
└──────────┘     └────┬─────┘     └──────────┘
                      │
                 ┌────┴─────┐
                 │          │
            ┌────▼───┐ ┌───▼────┐
            │ MinIO  │ │Mailpit │
            │ :9000  │ │ :1025  │
            └────────┘ └────────┘
```

### AWS 本番環境

```
Client
  └─▶ CloudFront (WAF)
        ├─ /* ──────────▶ S3 (フロントエンド静的ファイル)
        └─ /api/* ──────▶ API Gateway ──▶ Lambda (Hono API)
                                              ├─▶ RDS Proxy ──▶ RDS MySQL
                                              ├─▶ S3 (QR コード画像)
                                              └─▶ SQS (非同期 QR 生成)
                                                    └─▶ SQS Worker Lambda

EventBridge (cron: 毎日 JST 9:00)
  └─▶ Daily Report Lambda ──▶ SES (メール送信)
```

> 詳細なアーキテクチャ図: [`terraform/architecture-by-claudecode.drawio`](terraform/architecture-by-claudecode.drawio)

## セットアップ

### 前提条件

- Docker / Docker Compose
- Google OAuth 認証情報（[Google Cloud Console](https://console.cloud.google.com/) で取得）

### ローカル開発環境の構築

1. リポジトリをクローン

   ```bash
   git clone https://github.com/<your-username>/react-hono-practice.git
   cd react-hono-practice
   ```

2. 環境変数を設定

   ```bash
   cp backend/.env.example backend/.env
   ```

   `backend/.env` を編集し、以下を設定してください。

   | 変数名 | 設定内容 |
   |--------|----------|
   | `BETTER_AUTH_SECRET` | 任意の秘密鍵文字列 |
   | `GOOGLE_CLIENT_ID` | Google OAuth クライアント ID |
   | `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット |

   その他の変数は `.env.example` のデフォルト値で動作します。

3. Docker Compose で起動

   ```bash
   docker compose up
   ```

   起動時に自動で `npm ci`（依存インストール）と `drizzle-kit push`（DB マイグレーション）が実行されます。

4. MinIO バケットの作成

   [MinIO Console（http://localhost:9090）](http://localhost:9090) にアクセスし（ユーザー: `minio_root` / パスワード: `minio_password`）、`qrcodes` バケットを作成してください。

5. アプリケーションへアクセス

   | サービス | URL |
   |----------|-----|
   | フロントエンド | http://localhost:5173 |
   | バックエンド API | http://localhost:3000 |
   | Mailpit（メール確認） | http://localhost:8025 |
   | MinIO Console | http://localhost:9090 |

## 主な機能

| 機能 | 概要 |
|------|------|
| Google OAuth 認証 | BetterAuth によるログイン。セッション Cookie で認証状態を管理 |
| QR コード生成（同期） | API リクエストで即座に QR コード画像を生成し S3 にアップロード |
| QR コード生成（非同期） | SQS キューにジョブを送信し、Worker Lambda が非同期で生成。ステータスポーリングで完了を確認 |
| メール送信 | ローカルでは Mailpit、本番では SES 経由でメール送信 |
| 日次バッチレポート | EventBridge が毎日 JST 9:00 に Lambda を起動し、前日の QR コード集計をメールで全ユーザーに送信 |

## プロジェクト構成

```
react-hono-practice/
├── backend/                  # Hono API サーバー
│   └── src/
│       ├── app.ts            # Hono アプリ定義
│       ├── lambda.ts         # Lambda ハンドラー (API Gateway)
│       ├── sqs-handler.ts    # SQS ワーカー
│       ├── daily-report.ts   # 日次レポート Lambda
│       ├── migrate.ts        # マイグレーション Lambda
│       ├── routes/           # API ルート定義
│       ├── controllers/      # コントローラー
│       ├── services/         # ビジネスロジック (QR, メール, ストレージ)
│       ├── config/           # DB・認証・S3・メール設定
│       └── db/               # Drizzle スキーマ・マイグレーション
├── frontend/                 # React + Vite アプリ
│   └── src/
│       ├── pages/            # ページコンポーネント
│       ├── components/       # UI コンポーネント
│       ├── contexts/         # AuthContext
│       └── lib/              # 認証クライアント設定
├── terraform/                # AWS インフラ (Terraform)
│   ├── modules/              # 再利用可能なインフラモジュール
│   └── stg/                  # ステージング環境
├── docker/                   # Docker 設定
├── docker-compose.yml
└── docs/                     # 詳細ドキュメント
```

## ドキュメント

### 設計・設定

- [architecture.md](docs/architecture.md) — アーキテクチャ概要、技術スタック、ディレクトリ構造
- [api-specification.md](docs/api-specification.md) — API エンドポイント仕様
- [environment-config.md](docs/environment-config.md) — 環境変数リファレンス

### AWS・インフラ

- [terraform-migration.md](docs/terraform-migration.md) — Terraform インフラ構築ガイド
- [lambda-esbuild-guide.md](docs/lambda-esbuild-guide.md) — esbuild による Lambda ビルド
- [sqs-queue-processing.md](docs/sqs-queue-processing.md) — SQS 非同期 QR コード生成
- [daily-report-batch.md](docs/daily-report-batch.md) — EventBridge 日次レポートバッチ
- [ses-smtp-guide.md](docs/ses-smtp-guide.md) — SES メール設定
- [rds-proxy-iam-auth-guide.md](docs/rds-proxy-iam-auth-guide.md) — RDS Proxy IAM 認証
- [secrets-manager-guide.md](docs/secrets-manager-guide.md) — Secrets Manager の利用
- [cloudfront-apigateway-403-guide.md](docs/cloudfront-apigateway-403-guide.md) — CloudFront + API Gateway 403 エラー対処

### アプリケーション

- [better-auth-migration-guide.md](docs/better-auth-migration-guide.md) — BetterAuth 移行ガイド
- [drizzle-migration-guide.md](docs/drizzle-migration-guide.md) — Drizzle ORM マイグレーション
- [mysql2-guide.md](docs/mysql2-guide.md) — mysql2 ドライバー
- [usecontext-guide.md](docs/usecontext-guide.md) — React useContext

## CI/CD

GitHub Actions で以下のワークフローを用意しています（すべて手動トリガー）。

| ワークフロー | 内容 |
|-------------|------|
| `deploy-ecr-backend-lambda.yml` | バックエンドの Docker イメージを ECR にプッシュ |
| `update-lambda.yml` | Lambda 関数のコード更新 |
| `s3-deploy-frontend.yml` | フロントエンドを S3 にデプロイ + CloudFront キャッシュ無効化 |
| `terraform-apply.yml` | Terraform によるインフラ適用 |
| `terraform-stg-destroy.yml` | ステージング環境の破棄 |

## ライセンス

個人の学習・練習目的で作成したプロジェクトです。
