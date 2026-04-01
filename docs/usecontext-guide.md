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

## 4ファイルの関係図

```
authContext.types.ts    ← 型定義とContext作成
       ↓
AuthContext.tsx          ← Contextに値をセットする Provider
       ↓
App.tsx                  ← Providerでアプリ全体を囲む
       ↓
useAuth.ts               ← Contextから値を取り出すカスタムフック
       ↓
各ページコンポーネント    ← useAuth() で user や logout を使う
```

## 各ファイルの役割

### 1. `authContext.types.ts` — 箱を作る

```typescript
// 「認証情報を入れる箱」を作る（中身はまだ空）
export const AuthContext = createContext<AuthContextType | undefined>(undefined);
```

`createContext` は**グローバルな入れ物（箱）**を作る。この時点では中身は `undefined`。

### 2. `AuthContext.tsx` — 箱に中身を入れる

```typescript
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  // ... login, logout, checkAuth を定義 ...

  return (
    // AuthContext.Provider で箱に値を入れる
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
      {children}  {/* ← 子コンポーネント全てがこの値にアクセスできる */}
    </AuthContext.Provider>
  );
};
```

`Provider` が**箱に中身（value）を入れる役割**。

### 3. `App.tsx` — Provider でアプリを囲む

```typescript
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>       {/* ← ここで囲んだ範囲の子孫が値にアクセスできる */}
        <Routes>
          <Route path="/dashboard" element={
            <ProtectedRoute><Dashboard /></ProtectedRoute>
          } />
          ...
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

`AuthProvider` の内側にある全コンポーネントが認証情報にアクセスできる。

### 4. `useAuth.ts` — 箱から中身を取り出す

```typescript
export const useAuth = () => {
  // useContext で AuthContext（箱）から中身を取り出す
  const context = useContext(AuthContext);

  // Provider の外で使われた場合は undefined になるのでエラーにする
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;  // { user, isLoading, login, logout, checkAuth }
};
```

各ページではこう使う:

```typescript
const { user, logout } = useAuth();
// → user.name でユーザー名を表示
// → logout() でログアウト実行
```

`useAuth` でラップしている理由は、毎回 `useContext(AuthContext)` と書く手間を省くのと、Provider の外で誤って使った場合にエラーを出すため。

## 流れのまとめ

```
1. createContext()        → 空の箱を作る
2. Provider value={...}   → 箱に値を入れる
3. App で Provider で囲む  → どの範囲のコンポーネントがアクセスできるか決める
4. useContext()           → 箱から値を取り出す（useAuth でラップ）
```
