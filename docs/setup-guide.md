# 開発環境セットアップガイド

## 前提条件

- Docker / Docker Compose
- Google Cloud Console で OAuth 2.0 クライアント ID を取得済み

## セットアップ手順

### 1. 環境変数ファイルの作成

```bash
cp backend/.env.example backend/.env
```

### 2. Google OAuth 設定

`backend/.env` を編集し、Google OAuth のクライアント ID とシークレットを設定:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Google Cloud Console で以下を設定:
- **承認済みリダイレクト URI:** `http://localhost:3000/api/auth/google/callback`

### 3. Docker Compose で起動

```bash
docker compose up
```

初回起動時に以下が自動実行されます:
- `npm ci` (依存関係インストール)
- `npx drizzle-kit push` (DB マイグレーション)
- MinIO バケット作成 + 公開読み取りポリシー設定

### 4. アクセス

| サービス | URL |
|---------|-----|
| フロントエンド | http://localhost:5173 |
| バックエンド API | http://localhost:3000/api |
| ヘルスチェック | http://localhost:3000/api/health |
| Mailpit UI | http://localhost:8025 |
| MinIO Console | http://localhost:9090 |

MinIO Console のログイン:
- ユーザー: `minio_root`
- パスワード: `minio_password`

## 動作確認

1. http://localhost:5173 にアクセス
2. Google OAuth でログイン
3. ダッシュボードにユーザー情報が表示されることを確認
4. QR コードを生成し、MinIO に画像が保存されることを確認
5. メールを送信し、Mailpit UI (http://localhost:8025) で確認

## トラブルシューティング

### DB 接続エラー

MySQL の起動に時間がかかる場合があります。hono コンテナは MySQL の healthcheck に依存しているため、MySQL が ready になるまで待機します。

### MinIO バケットエラー

アプリ起動時にバケットが自動作成されます。MinIO コンテナが起動していない場合は警告ログが出ますが、次回の操作時にリトライされます。
