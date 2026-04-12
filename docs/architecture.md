# アーキテクチャ概要

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React + Vite + TypeScript |
| バックエンド | Hono (Node.js) + TypeScript |
| ORM | Drizzle ORM |
| データベース | MySQL 8.0 |
| オブジェクトストレージ | MinIO (dev) / S3 (prod) |
| メール | Mailpit (dev) / SES SMTP (prod) |
| 認証 | BetterAuth (Google OAuth) |
| IaC | Terraform |

## アーキテクチャ図

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

## ディレクトリ構造

```
react-hono-practice/
├── backend/
│   ├── src/
│   │   ├── index.ts              # サーバー起動 (ローカル開発用)
│   │   ├── app.ts                # Hono アプリ、ミドルウェア登録
│   │   ├── lambda.ts             # AWS Lambda ハンドラー (API Gateway)
│   │   ├── sqs-handler.ts        # SQS ハンドラー (QRコード非同期生成)
│   │   ├── daily-report.ts       # 日次レポート Lambda (EventBridge 起動)
│   │   ├── migrate.ts            # マイグレーション Lambda
│   │   ├── config/
│   │   │   ├── env.ts            # 環境変数の型付き設定
│   │   │   ├── database.ts       # Drizzle DB 接続
│   │   │   ├── storage.ts        # S3/MinIO クライアント
│   │   │   ├── mail.ts           # Nodemailer トランスポーター
│   │   │   └── auth.ts           # BetterAuth 設定 (Google OAuth)
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle テーブル定義
│   │   │   └── migrations/       # drizzle-kit 生成
│   │   ├── middleware/
│   │   │   └── auth.ts           # 認証ガード (BetterAuth セッション検証)
│   │   ├── routes/
│   │   │   ├── index.ts          # ルート集約
│   │   │   ├── users.ts          # ユーザールート
│   │   │   ├── qrcodes.ts        # QRコードルート
│   │   │   ├── mail.ts           # メールルート
│   │   │   └── health.ts         # ヘルスチェック
│   │   ├── controllers/
│   │   │   ├── users.controller.ts
│   │   │   ├── qrcodes.controller.ts
│   │   │   └── mail.controller.ts
│   │   ├── services/
│   │   │   ├── qrcode.service.ts # QR 生成 + S3 アップロード
│   │   │   ├── mail.service.ts   # メール送信
│   │   │   └── storage.service.ts# ファイルアップロード + URL 生成
│   │   └── types/
│   │       └── index.ts          # 共有型定義
│   ├── drizzle.config.ts
│   ├── package.json
│   └── .env.example
├── frontend/                     # React アプリ
├── terraform/                    # AWS インフラ (Terraform)
│   ├── lambda/
│   │   └── notification.py       # SNS 通知用 Lambda
│   ├── modules/
│   │   └── app-infrastructure/   # 再利用可能なインフラモジュール
│   │       ├── vpc.tf            # VPC / サブネット
│   │       ├── rds.tf            # RDS (MySQL)
│   │       ├── rds_proxy.tf      # RDS Proxy
│   │       ├── lambda.tf         # Lambda 関数
│   │       ├── api_gateway.tf    # API Gateway
│   │       ├── cloudfront.tf     # CloudFront ディストリビューション
│   │       ├── s3.tf             # S3 バケット
│   │       ├── sqs.tf            # SQS キュー
│   │       ├── ses.tf            # SES メール送信
│   │       ├── sns.tf            # SNS 通知
│   │       ├── event_bridge.tf   # EventBridge スケジュール
│   │       ├── cloudwatch.tf     # CloudWatch アラーム / ログ
│   │       ├── waf.tf            # WAF
│   │       ├── acm.tf            # ACM 証明書
│   │       ├── route53.tf        # Route 53 DNS
│   │       ├── secrets_manager.tf# Secrets Manager
│   │       ├── ssm.tf            # SSM Parameter Store
│   │       ├── security_groups.tf# セキュリティグループ
│   │       ├── iam_role.tf       # IAM ロール
│   │       ├── iam_policy.tf     # IAM ポリシー
│   │       ├── data.tf           # データソース
│   │       ├── local.tf          # ローカル変数
│   │       ├── variables.tf      # 入力変数
│   │       └── providers.tf      # プロバイダー設定
│   └── stg/                      # ステージング環境
│       ├── main.tf               # モジュール呼び出し
│       ├── providers.tf          # プロバイダー設定
│       ├── variables.tf          # 変数定義
│       └── terraform.tfvars      # 変数値
├── test/                         # `npm create hono@latest` で各デプロイ先テンプレートを試したフォルダ
│   ├── aws-lambda/              # AWS Lambda テンプレート
│   ├── cloudflare-workers/      # Cloudflare Workers テンプレート
│   ├── cloudflare-workers-vite/ # Cloudflare Workers (Vite) テンプレート
│   ├── lambda-edge/             # Lambda@Edge テンプレート
│   └── node/                    # Node.js テンプレート
├── docker/                       # Docker 設定
├── docker-compose.yml
└── docs/                         # ドキュメント
```

## 認証フロー (BetterAuth)

BetterAuth が `/api/auth/*` 以下のルートを自動的にハンドリングする（`app.ts` で `getAuth().handler` に委譲）。

1. フロントエンドが BetterAuth クライアント経由で `GET /api/auth/sign-in/social` (provider: google) を呼び出し
2. BetterAuth が Google OAuth URL を生成しリダイレクト
3. ユーザーが Google でログイン
4. コールバック URL で BetterAuth がトークンを検証し、`users` / `accounts` テーブルにユーザー情報を保存
5. `sessions` テーブルにセッションを作成し、Cookie でセッショントークンを管理
6. 以降のリクエストは `authMiddleware` が `getAuth().api.getSession()` でセッションを検証しユーザーを識別

## ストレージ戦略

- DB には `file_name` (キー) のみ保存
- URL は `STORAGE_URL_BASE` 環境変数 + `file_name` で動的生成
  - Dev: `http://localhost:9000/qrcodes/{file_name}`
  - Prod: `https://xxxx.cloudfront.net/{file_name}`
