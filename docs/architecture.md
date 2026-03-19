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
| 認証 | Google OAuth (arctic) + セッション |

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
│   │   ├── index.ts              # サーバー起動
│   │   ├── app.ts                # Hono アプリ、ミドルウェア登録
│   │   ├── config/
│   │   │   ├── env.ts            # 環境変数の型付き設定
│   │   │   ├── database.ts       # Drizzle DB 接続
│   │   │   ├── storage.ts        # S3/MinIO クライアント
│   │   │   ├── mail.ts           # Nodemailer トランスポーター
│   │   │   └── auth.ts           # Google OAuth 設定 (arctic)
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle テーブル定義
│   │   │   └── migrations/       # drizzle-kit 生成
│   │   ├── middleware/
│   │   │   ├── session.ts        # セッション管理 (MySQL ストア)
│   │   │   └── auth.ts           # 認証ガード
│   │   ├── routes/
│   │   │   ├── index.ts          # ルート集約
│   │   │   ├── auth.ts           # 認証ルート
│   │   │   ├── users.ts          # ユーザールート
│   │   │   ├── qrcodes.ts        # QRコードルート
│   │   │   ├── mail.ts           # メールルート
│   │   │   └── health.ts         # ヘルスチェック
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
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
├── docker/                       # Docker 設定
├── docker-compose.yml
└── docs/                         # ドキュメント
```

## 認証フロー

1. フロントエンドが `GET /api/auth/google` を呼び出し、Google OAuth URL を取得
2. ユーザーが Google でログイン
3. コールバック `GET /api/auth/google/callback` でユーザー情報を取得・保存
4. MySQL sessions テーブルにセッションを保存、Cookie でセッション ID を管理
5. 以降のリクエストは Cookie のセッション ID でユーザーを識別

## ストレージ戦略

- DB には `file_name` (キー) のみ保存
- URL は `STORAGE_URL_BASE` 環境変数 + `file_name` で動的生成
  - Dev: `http://localhost:9000/qrcodes/{file_name}`
  - Prod: `https://xxxx.cloudfront.net/{file_name}`
