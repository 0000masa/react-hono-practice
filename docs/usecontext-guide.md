# useContext ガイド

## useContext で何を解決しているか

useContext がないと、深い階層のコンポーネントにデータを渡すには**バケツリレー（props drilling）**が必要になる。

```
App → Dashboard → Header → UserMenu → user を表示
       ↑ user を props で渡す → ↑ さらに渡す → ↑ さらに渡す
```

useContext を使うと、**途中を飛ばして直接アクセス**できる。

```
App（Providerで user をセット）
  └─ Dashboard
       └─ Header
            └─ UserMenu ← useAuth() で直接 user を取得
```

## 5ファイルの関係図

```
auth-client.ts           ← BetterAuth クライアント作成
       ↓
authContext.types.ts     ← 型定義とContext作成
       ↓
AuthContext.tsx           ← auth-client を使って値をセットする Provider
       ↓
App.tsx                   ← Providerでアプリ全体を囲む
       ↓
useAuth.ts                ← Contextから値を取り出すカスタムフック
       ↓
各ページコンポーネント     ← useAuth() で user や logout を使う
```

## 各ファイルの役割

### 1. `auth-client.ts` — BetterAuth クライアントを作る

```typescript
import { createAuthClient } from 'better-auth/react';

const baseURL = import.meta.env.VITE_API_BASE_URL;

export const authClient = createAuthClient({
  baseURL: baseURL ? baseURL.replace(/\/api$/, '') : '',
  basePath: '/api/auth',
});
```

`authClient` はバックエンドの BetterAuth API と通信するためのクライアント。セッション取得 (`getSession`)、ログアウト (`signOut`)、Google ログイン (`signIn.social`) などのメソッドを提供する。

### 2. `authContext.types.ts` — 箱を作る

```typescript
export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

// 「認証情報を入れる箱」を作る（中身はまだ空）
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
```

`createContext` は**グローバルな入れ物（箱）**を作る。この時点では中身は `undefined`。

### 3. `AuthContext.tsx` — 箱に中身を入れる

```typescript
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkSession = async () => {
      const { data: session } = await authClient.getSession();
      if (session?.user) {
        setUser({
          id: Number(session.user.id),
          name: session.user.name,
          email: session.user.email,
          avatar_url: session.user.image ?? null,
        });
      }
      setIsLoading(false);
    };
    checkSession();
  }, []);

  const logout = async () => {
    await authClient.signOut();
    setUser(null);
  };

  return (
    // AuthContext.Provider で箱に値を入れる
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}  {/* ← 子コンポーネント全てがこの値にアクセスできる */}
    </AuthContext.Provider>
  );
};
```

`Provider` が**箱に中身（value）を入れる役割**。マウント時に `authClient.getSession()` でセッションを確認し、ユーザー情報を Context にセットする。

### 4. `App.tsx` — Provider でアプリを囲む

```typescript
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>       {/* ← ここで囲んだ範囲の子孫が値にアクセスできる */}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={
            <ProtectedRoute><Dashboard /></ProtectedRoute>
          } />
          <Route path="/auth/callback" element={<Callback />} />
          ...
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

`AuthProvider` の内側にある全コンポーネントが認証情報にアクセスできる。

### 5. `useAuth.ts` — 箱から中身を取り出す

```typescript
export const useAuth = () => {
  // useContext で AuthContext（箱）から中身を取り出す
  const context = useContext(AuthContext);

  // Provider の外で使われた場合は undefined になるのでエラーにする
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;  // { user, isLoading, logout }
};
```

各ページではこう使う:

```typescript
const { user, logout } = useAuth();
// → user.name でユーザー名を表示
// → logout() でログアウト実行
```

`useAuth` でラップしている理由は、毎回 `useContext(AuthContext)` と書く手間を省くのと、Provider の外で誤って使った場合にエラーを出すため。

なお、ログイン処理は `authClient.signIn.social({ provider: 'google' })` を直接呼ぶため Context には含まれていない（Login ページでのみ使用）。

## 流れのまとめ

```
1. createAuthClient()     → BetterAuth クライアントを作る（バックエンドとの通信用）
2. createContext()         → 空の箱を作る
3. Provider value={...}    → authClient でセッションを取得し、箱に値を入れる
4. App で Provider で囲む   → どの範囲のコンポーネントがアクセスできるか決める
5. useContext()            → 箱から値を取り出す（useAuth でラップ）
```
