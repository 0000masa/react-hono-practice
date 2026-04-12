# BetterAuth 移行ガイド（Arctic → BetterAuth）

## なぜ移行したのか

元々の認証は **Arctic** + **カスタムセッションミドルウェア** で構築していた。
これは「OAuth の認可コードフロー」と「セッション管理」を自前で実装する構成。

BetterAuth は OAuth・セッション・DB 連携をワンパッケージで提供するため、以下のメリットがある:

- 認証ロジックのコード量が大幅に減る
- セッション管理・Cookie 設定のベストプラクティスが組み込まれている
- 追加プロバイダー（GitHub、Discord 等）や 2FA を設定だけで追加できる
- フロントエンド向け SDK（React hooks）が付属している

---

## Arctic と BetterAuth の違い

| 観点 | Arctic | BetterAuth |
|------|--------|------------|
| 役割 | OAuth フローのヘルパーのみ | OAuth + セッション + DB 管理を一括 |
| セッション管理 | 自前で実装が必要 | 内蔵（DB 保存 + Cookie 自動管理） |
| DB 連携 | なし（自分で書く） | Drizzle / Prisma 等のアダプター付き |
| フロントエンド SDK | なし | `better-auth/react` で hooks 提供 |
| 認証ルート | 自分で Controller を書く | `auth.handler()` が自動で処理 |
| プロバイダー追加 | 各プロバイダーのクラスを個別に使う | `socialProviders` に設定を足すだけ |

### Arctic の構成（移行前）

```
フロントエンド                    バックエンド
─────────────                ──────────────────────────────────
GET /api/auth/google ──────→ auth.controller.ts
                              ├ Arctic で認可URL生成
                              ├ state/codeVerifier を Cookie に保存
                              └ { url } を返す
                    ←──────  

window.location.href = url
       ↓
  Google 認証画面
       ↓
GET /api/auth/google/callback → auth.controller.ts
                                 ├ Arctic でトークン交換
                                 ├ Google API でユーザー情報取得
                                 ├ DB に upsert
                                 └ カスタム session middleware でセッション作成

GET /api/auth/user ──────→ auth middleware → auth.controller.ts
                            (session.userId を確認)
```

必要だったファイル:
- `config/auth.ts` — Arctic の Google クライアント初期化
- `controllers/auth.controller.ts` — redirectToGoogle, handleGoogleCallback, getUser, logout
- `middleware/session.ts` — セッション作成・読込・永続化（全 API リクエストで実行）
- `middleware/auth.ts` — セッションからユーザーを取得
- `routes/auth.ts` — 4 つのエンドポイント定義

### BetterAuth の構成（移行後）

```
フロントエンド                    バックエンド
─────────────                ──────────────────────────────────
authClient.signIn.social() → POST /api/auth/sign-in/social
                              └ BetterAuth が認可URL生成 + リダイレクト

  Google 認証画面
       ↓
GET /api/auth/callback/google → BetterAuth が自動処理
                                 ├ トークン交換
                                 ├ ユーザー情報取得
                                 ├ DB に upsert (accounts テーブル)
                                 ├ セッション作成 (sessions テーブル)
                                 └ callbackURL にリダイレクト

authClient.getSession() ──→ GET /api/auth/get-session
                              └ BetterAuth がセッション検証 + ユーザー返却
```

必要なファイル:
- `config/auth.ts` — `betterAuth()` の設定（これ 1 ファイルだけ）
- `middleware/auth.ts` — `auth.api.getSession()` で保護ルートのガード

---

## 移行で行った変更の詳細

### 1. DB スキーマの変更

BetterAuth は 4 つのコアテーブルを使う: `users`, `sessions`, `accounts`, `verifications`

```
移行前の DB                       移行後の DB
──────────                       ──────────
users (※既存)                    users (※カラム名変更あり)
├ google_id   ──(移動)──→        accounts.account_id
├ avatar_url  ──(改名)──→        users.image
├ email_verified_at ──(変更)──→  users.email_verified (boolean)
├ password    ──(削除)──→        accounts.password (BetterAuth管理)
└ remember_token ──(削除)

sessions (※再定義)               sessions (BetterAuth形式)
├ token (unique)                  ← Cookie のセッショントークン
├ expires_at                      ← セッション有効期限
└ user_id FK → users.id

                                  accounts (※新規)
                                  ├ provider_id = "google"
                                  ├ account_id = Google のユーザーID
                                  └ access_token, refresh_token 等

                                  verifications (※新規)
                                  └ メール検証トークン等に使用
```

**ポイント**: `users` テーブルの PK は `bigint auto-increment` のまま維持。
BetterAuth のデフォルトは UUID (string) だが、`advanced.database.generateId: false` で DB の auto-increment に任せている。
`sessions`, `accounts`, `verifications` は `$defaultFn(() => crypto.randomUUID())` で UUID を生成。

### 2. バックエンドの変更

**`config/auth.ts`** — BetterAuth のサーバー設定:

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'mysql',
    schema,
    usePlural: true,   // テーブル名を複数形で探す (users, sessions, accounts...)
  }),
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7日間
    updateAge: 60 * 60 * 24,       // 1日経過でリフレッシュ
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,              // 5分間DBクエリをスキップ
    },
  },
  trustedOrigins: [env.FRONTEND_URL],
});
```

- `usePlural: true` により、BetterAuth が `user` ではなく `users`、`session` ではなく `sessions` テーブルを探す
- `cookieCache` を有効にすると、セッション情報を署名付き Cookie にキャッシュして DB クエリを減らせる
- `trustedOrigins` にフロントエンドの URL を指定して CORS を許可

**`app.ts`** — Hono へのマウント:

```typescript
// BetterAuth が /api/auth/* の全ルートを自動処理
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});
```

`auth.handler()` は Web 標準の `Request` を受け取り `Response` を返す。
Hono の `c.req.raw` で生の Request オブジェクトを渡す。

**`middleware/auth.ts`** — 保護ルートのガード:

```typescript
export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  c.set('user', {
    id: Number(session.user.id),  // BetterAuth は string で返すので変換
    name: session.user.name,
    email: session.user.email,
    // ...
  });

  await next();
});
```

`auth.api.getSession()` はサーバーサイドでセッションを検証する API。
Cookie の `better-auth.session_token` を読み取り、DB (またはキャッシュ) からセッションを取得する。

### 3. フロントエンドの変更

後述の「createAuthClient の仕組み」セクションで詳しく説明。

### 4. 環境変数の変更

```
追加:  BETTER_AUTH_SECRET  — セッションの署名・暗号化に使う秘密鍵
削除:  GOOGLE_CALLBACK_URL — BetterAuth が basePath から自動決定
削除:  SESSION_SECRET      — BetterAuth が BETTER_AUTH_SECRET を使用
```

### 5. Google Cloud Console の変更

承認済みリダイレクト URI を変更:
- **旧**: `http://localhost:3000/api/auth/google/callback`
- **新**: `http://localhost:3000/api/auth/callback/google`

BetterAuth は `/api/auth/callback/{provider}` の形式を使う。

---

## createAuthClient の仕組み

### セットアップ

```typescript
// frontend/src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: '',          // 同一オリジンなら空文字でOK
  basePath: '/api/auth', // バックエンドの BetterAuth basePath と一致させる
});
```

`createAuthClient` は BetterAuth のサーバーと通信するクライアントオブジェクトを返す。
React 環境では `better-auth/react` から import することで、React hooks も使える。

### 主要な API

#### `authClient.signIn.social()` — ソーシャルログイン

```typescript
await authClient.signIn.social({
  provider: 'google',
  callbackURL: '/dashboard',  // 認証成功後のリダイレクト先
});
```

内部動作:
1. `POST /api/auth/sign-in/social` を `fetch` で呼ぶ（`{ provider: "google", callbackURL: "/dashboard" }` を送信）
2. バックエンドが Google の認可 URL を生成
3. クライアントが `window.location.href` で Google にリダイレクト
4. Google で認証後、`GET /api/auth/callback/google` にコールバック
5. BetterAuth がセッション作成後、`callbackURL` にリダイレクト

#### `authClient.getSession()` — セッション取得

```typescript
const { data: session } = await authClient.getSession();

if (session?.user) {
  console.log(session.user.name);   // ユーザー名
  console.log(session.user.email);  // メールアドレス
  console.log(session.user.image);  // アバター画像URL
}
```

内部動作:
1. `GET /api/auth/get-session` を `fetch({ credentials: 'include' })` で呼ぶ
2. バックエンドが Cookie のセッショントークンを検証
3. `{ session, user }` オブジェクトを返す（未認証なら `null`）

#### `authClient.useSession()` — React Hook 版

```typescript
function MyComponent() {
  const { data: session, isPending, error } = authClient.useSession();

  if (isPending) return <p>読み込み中...</p>;
  if (!session) return <p>未ログイン</p>;

  return <p>こんにちは、{session.user.name}さん</p>;
}
```

`useSession()` は `getSession()` の React Hook 版。コンポーネントのマウント時に自動でセッションを取得し、状態を管理する。

#### `authClient.signOut()` — ログアウト

```typescript
await authClient.signOut();
```

内部動作:
1. `POST /api/auth/sign-out` を呼ぶ
2. バックエンドが DB からセッションを削除
3. セッション Cookie をクリア

### AuthContext での使い方

```typescript
// contexts/AuthContext.tsx
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: session } = await authClient.getSession();
        if (session?.user) {
          setUser({
            id: Number(session.user.id),
            name: session.user.name,
            email: session.user.email,
            avatar_url: session.user.image ?? null,
          });
        }
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
  }, []);

  const logout = async () => {
    await authClient.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

**`getSession()` と `useSession()` の使い分け**:
- `getSession()` — 一度だけ呼びたい場合（初期化時など）。`useEffect` 内で使う
- `useSession()` — コンポーネント内でリアクティブにセッション状態を取得したい場合

今回は `AuthContext` で一元管理しているため `getSession()` を使い、各コンポーネントは `useAuth()` hook 経由でユーザー情報にアクセスする既存パターンを維持している。

---

## BetterAuth が自動で作るエンドポイント一覧

`basePath: '/api/auth'` の場合:

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/auth/sign-in/social` | ソーシャルログイン開始 |
| GET | `/api/auth/callback/:provider` | OAuth コールバック |
| GET | `/api/auth/get-session` | セッション取得 |
| POST | `/api/auth/sign-out` | ログアウト |

これらは `app.on(['POST', 'GET'], '/api/auth/*', ...)` で一括キャッチされ、`auth.handler()` が処理する。

---

## DB マイグレーションの実行手順

### 手順

```bash
cd backend

# 1. マイグレーションファイルを生成
npx drizzle-kit generate

# 2. マイグレーションを DB に適用
npx drizzle-kit push
# または（Lambda のマイグレーションハンドラーを使う場合）
npx tsx src/migrate.ts
```

### `drizzle-kit generate` 実行時の対話プロンプト

スキーマの差分が大きい場合、Drizzle Kit が「このカラムは新規作成？それとも既存カラムのリネーム？」と聞いてくる。

```
Is token column in sessions table created or renamed from another column?
❯ + token                 create column
  ~ payload › token       rename column
  ~ last_activity › token rename column
```

**すべて `create column` を選ぶ。** 理由:

| 質問されるカラム | なぜ create なのか |
|---|---|
| `sessions.token` | 旧 `payload`（JSON文字列）とは別物。セッショントークン用 |
| `sessions.expires_at` | 旧 `last_activity`（UNIX int）とは型も用途も異なる |
| `users.email_verified` | 旧 `email_verified_at`（timestamp）→ boolean に型変更 |
| `users.image` | 旧 `avatar_url` からのリネームだが、BetterAuth の規約に合わせた新カラム |

`rename` を選ぶと Drizzle Kit は `ALTER TABLE ... RENAME COLUMN` を生成するが、**型が変わる場合（timestamp → boolean 等）はリネームだけでは不十分**でエラーになる。`create` を選べば `DROP COLUMN` + `ADD COLUMN` が生成されるので安全。

### 既存ユーザーデータの扱い

マイグレーション後、既存ユーザーは `users` テーブルに残るが、`accounts` テーブルにはまだ紐付けがない。
次回 Google ログイン時に BetterAuth が自動で `accounts` レコードを作成するため、手動のデータ移行は不要。

ただし、旧カラム（`google_id`, `password`, `remember_token`）のデータは `DROP COLUMN` で失われる。
必要であればマイグレーション適用前にバックアップを取ること:

```bash
# バックアップ例
mysqldump -u user -p database users > users_backup.sql
```

---

## トラブルシューティング

### CORS エラーが出る

`trustedOrigins` にフロントエンドの URL が入っているか確認:

```typescript
export const auth = betterAuth({
  trustedOrigins: [env.FRONTEND_URL],  // "http://localhost:5173"
});
```

Hono 側の CORS 設定で `credentials: true` が必要:

```typescript
app.use('/api/*', cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));
```

### Google ログイン後に 404 になる

Google Cloud Console のリダイレクト URI が BetterAuth の形式になっているか確認:
- **正**: `http://localhost:3000/api/auth/callback/google`
- **誤**: `http://localhost:3000/api/auth/google/callback`

### セッションが維持されない

1. `BETTER_AUTH_SECRET` が設定されているか確認
2. フロントエンドの `fetch` に `credentials: 'include'` が付いているか確認
3. Cookie の `SameSite` / `Secure` 属性が環境に合っているか確認（開発環境では HTTP でも動作する）
