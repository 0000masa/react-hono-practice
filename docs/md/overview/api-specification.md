# API 仕様書

ベース URL: `/api`

## 認証

### Google OAuth リダイレクト

```
GET /api/auth/google
```

**レスポンス (200):**
```json
{
  "url": "https://accounts.google.com/o/oauth2/auth?..."
}
```

### Google OAuth コールバック

```
GET /api/auth/google/callback?code=...&state=...
```

**成功時:** `FRONTEND_URL/auth/callback` へリダイレクト
**失敗時:** `FRONTEND_URL/auth/error` へリダイレクト

### 認証済みユーザー取得

```
GET /api/auth/user
```

**認証:** 必要

**レスポンス (200):**
```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "avatar_url": "https://lh3.googleusercontent.com/..."
  }
}
```

**レスポンス (401):**
```json
{
  "error": "認証が必要です"
}
```

### ログアウト

```
POST /api/auth/logout
```

**認証:** 必要

**レスポンス (200):**
```json
{
  "message": "ログアウトしました"
}
```

---

## ユーザー

### ユーザー一覧

```
GET /api/users?page=1
```

**認証:** 必要

**レスポンス (200):**
```json
{
  "users": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://...",
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "last_page": 1,
    "per_page": 50,
    "total": 1,
    "from": 1,
    "to": 1
  }
}
```

---

## QR コード

### QR コード一覧

```
GET /api/qrcodes?page=1
```

**認証:** 必要

**レスポンス (200):**
```json
{
  "qrcodes": [
    {
      "id": 1,
      "user_id": 1,
      "user": {
        "id": 1,
        "name": "John Doe",
        "email": "john@example.com"
      },
      "file_name": "1_1705318200_507f1f77.png",
      "url": "http://localhost:9000/qrcodes/1_1705318200_507f1f77.png",
      "data": "https://example.com",
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "last_page": 1,
    "per_page": 50,
    "total": 1,
    "from": 1,
    "to": 1
  }
}
```

### QR コード生成 (同期)

```
POST /api/qrcodes
Content-Type: application/json
```

**リクエスト:**
```json
{
  "data": "https://example.com"
}
```

**バリデーション:** `data` - 必須, 文字列, 最大 1000 文字

**レスポンス (201):**
```json
{
  "message": "QRコードを生成しました",
  "qrcode": {
    "id": 1,
    "user_id": 1,
    "file_name": "1_1705318200_507f1f77.png",
    "data": "https://example.com",
    "status": "completed",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "url": "http://localhost:9000/qrcodes/1_1705318200_507f1f77.png"
  }
}
```

**レスポンス (422):**
```json
{
  "error": "バリデーションエラー",
  "messages": {
    "data": ["data は必須です"]
  }
}
```

### QR コード生成 (非同期)

```
POST /api/qrcodes/async
Content-Type: application/json
```

**リクエスト:**
```json
{
  "data": "https://example.com"
}
```

**レスポンス (202):**
```json
{
  "message": "QRコード生成ジョブをキューに投入しました",
  "qrcode": {
    "id": 1,
    "status": "pending",
    "data": "https://example.com",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### QR コードステータス確認

```
GET /api/qrcodes/:id/status
```

**認証:** 必要

**レスポンス (200 - pending):**
```json
{
  "id": 1,
  "status": "pending",
  "data": "https://example.com",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

**レスポンス (200 - completed):**
```json
{
  "id": 1,
  "status": "completed",
  "data": "https://example.com",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:35:00.000Z",
  "url": "http://localhost:9000/qrcodes/1_1705318200_507f1f77.png",
  "file_name": "1_1705318200_507f1f77.png"
}
```

**レスポンス (404):**
```json
{
  "error": "QRコードが見つかりません"
}
```

---

## メール

### メール送信

```
POST /api/mail/send
Content-Type: application/json
```

**認証:** 必要

**リクエスト:**
```json
{
  "to": "user@example.com",
  "subject": "テスト件名",
  "message": "テスト本文"
}
```

**バリデーション:**
- `to` - 必須, 有効なメールアドレス
- `subject` - 必須, 最大 255 文字
- `message` - 必須, 最大 5000 文字

**レスポンス (200):**
```json
{
  "message": "メールを送信しました"
}
```

---

## ヘルスチェック

```
GET /api/health
```

**認証:** 不要

**レスポンス (200):**
```json
{
  "status": "ok"
}
```

---

## 共通エラーレスポンス

### 認証エラー (401)
```json
{
  "error": "認証が必要です"
}
```

### バリデーションエラー (422)
```json
{
  "error": "バリデーションエラー",
  "messages": {
    "field_name": ["エラーメッセージ"]
  }
}
```

### サーバーエラー (500)
```json
{
  "error": "エラーの説明",
  "message": "詳細なエラーメッセージ"
}
```
