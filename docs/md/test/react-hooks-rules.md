# React Hook のルール — なぜコンポーネント内でしか呼べないのか

このドキュメントは **「`useAuth` は普通の関数なのに、なぜコンポーネント外から呼べないのか?」** という疑問に答えるためのものです。`renderHook` がテストで何をしているか、`use` 接頭辞の命名規則の意義、ESLint との関係まで、まとめて 1 本で決着させます。

このドキュメントは、本プロジェクトでフックを書く / テストするときに「なんとなく動いているけど中身が分からない」を解消するのが目的で、React Fiber tree や concurrent mode の内部実装の詳細には踏み込みません。

---

## TL;DR

- **構文的には**どこからでも呼べる (Hook は普通の関数だから)
- でも React が中で **「今レンダリング中のコンポーネント」というグローバル状態**を見ているので、コンポーネント外で呼ぶと **ランタイム**で `Invalid hook call` が投げられる
- **カスタムフック** (`useAuth` など) は中で別の Hook を呼ぶので同じ制約を継承する
- `renderHook` は「制約を回避」ではなく、**テスト用コンポーネントを 1 個でっちあげて、その render 中に Hook を呼ばせる**仕組み

---

## 1. よくある誤解: 「Hook はただの関数だからどこからでも呼べる」

### 1.1 半分正解の部分

`useAuth` の定義は普通の関数:

```ts
// frontend/src/hooks/useAuth.ts
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
```

`useAuth()` という呼び出し自体は **TypeScript のレベルで何の警告も出ない**。型注釈上もただの `() => AuthContextType` の関数。Node スクリプトに import して `useAuth()` と書くこともシンタクティカリには可能です。

### 1.2 半分違う部分

`useAuth` の中で `useContext(AuthContext)` が呼ばれます。**この `useContext` (および `useState` / `useEffect` / `useRef` / `useReducer` ...) は React のレンダラーが「今どのコンポーネントをレンダリング中か」というグローバル状態を必要とする** ── ここがポイント。

その状態がセットされていないと:

```
Invalid hook call. Hooks can only be called inside of the body of a function component.
This could happen for one of the following reasons: ...
```

がランタイムで投げられます。型レベルでは止まらないので、**実行してみて初めて分かる**のがこの種のバグの厄介な点。

---

## 2. 構文 vs ランタイムの 2 層

3 つのチェックポイントを表で対比すると:

| 観点 | `useAuth()` を関数として呼ぶ | 中の `useContext` / `useState` の動作 |
|------|------------------------|-------------------------------|
| 構文 (TypeScript) | OK (普通の関数呼び出し) | OK (型は通る) |
| ESLint `rules-of-hooks` | コンポーネント or `use` 接頭辞関数の中なら OK | 同左 |
| React 実行時 | ── (`useAuth` 本体は何でもよい) | **レンダリング中のコンポーネント fiber が必要** |

3 段階のうち **どこかで止まれば呼べない**。ランタイムは最後の砦で、最も厳格に判定するのがここです。

> ひとこと: 「TypeScript が通った = 動く」ではない。Hook はランタイム制約を持つ特殊な関数。

---

## 3. なぜランタイムで止まるか — React 内部の仕組み

### 3.1 擬似コードで見る `useContext` の内側

React 内部にはグローバルな「今レンダリング中のコンポーネントを指す変数」があります。実名は React のバージョンや内部リファクタによって変わりますが (`ReactCurrentDispatcher` / `ReactCurrentOwner` / `currentlyRenderingFiber` 等)、概念的にはこういうコードに集約されます:

```ts
// React 内部の擬似コード (実物はもっと複雑だが概念図として)
let currentlyRenderingFiber: Fiber | null = null;

function useContext(Context) {
  if (currentlyRenderingFiber === null) {
    throw new Error('Invalid hook call. Hooks can only be called inside ...');
  }
  return currentlyRenderingFiber.findContextValue(Context);
}

function useState(initialValue) {
  if (currentlyRenderingFiber === null) {
    throw new Error('Invalid hook call. ...');
  }
  // 呼び出し順序に応じた slot を返す
  return currentlyRenderingFiber.getOrCreateHookSlot(initialValue);
}
```

React は `<App />` のような関数コンポーネントを呼び出す **その直前** に `currentlyRenderingFiber = appFiber` をセットし、終わったら `null` に戻す:

```ts
function renderComponent(component, fiber) {
  currentlyRenderingFiber = fiber;
  try {
    return component();           // ← この中で呼ばれた Hook だけが動ける
  } finally {
    currentlyRenderingFiber = null;
  }
}
```

これが「**コンポーネントレンダリング中だけ Hook が動く**」の正体です。

### 3.2 なぜそんな設計なのか — Hook の状態管理

React は Hook の戻り値を **「コンポーネント単位 + 呼び出し順序 (slot index)」** で管理します:

```tsx
function MyComp() {
  const [count, setCount] = useState(0);      // slot 0
  const [name, setName] = useState('Alice');  // slot 1
  const ctx = useContext(AuthContext);        // slot 2
}
```

MyComp の fiber には `[0, 'Alice', ctxValue]` のような配列が並んで保存され、次の render では同じ順序で読み出されます ── これが「Hook が値を持続させる」仕組みの正体。

コンポーネント外では「**どの fiber の何番目の slot か**」が決まらないので、Hook が動きようがありません。これが Rules of Hooks の根本的な理由です。

### 3.3 だから「条件分岐の中で Hook を呼ぶ」のも禁止

slot index は **呼び出し順序** で決まるため、`if` の中で `useState` すると条件次第で slot 番号がズレてしまい、別の slot の値を読んでしまうバグになります。

```tsx
function Buggy({ condA }) {
  if (condA) {
    const [a] = useState(0);  // slot 0 になったり、ならなかったり
  }
  const [b] = useState(0);    // slot 0 にも slot 1 にもなり得る → 値が壊れる
}
```

「条件分岐や loop の中で Hook を呼ばない」ルールは、§3.2 の状態管理方式の直接の帰結です。

> ひとこと: Hook の状態は配列の位置で管理されている。だから順序が固定でないと壊れる。

---

## 4. 呼び方の早見表

| 呼び方 | 動くか | 理由 |
|------|------|------|
| コンポーネントのレンダリング中に `useAuth()` | ✓ | `currentlyRenderingFiber` がセットされている |
| 別のカスタムフック (`useFoo`) の中で `useAuth()` | ✓ | `useFoo` も結局コンポーネントから呼ばれるので、最終的に同じ状況 |
| `setTimeout(() => useAuth(), 100)` | ✗ | レンダリング後の非同期コールバックで fiber は `null` |
| `<button onClick={() => useAuth()}>` のような eventハンドラ | ✗ | イベントハンドラはレンダリング外 |
| `useEffect(() => { useAuth(); })` の中 | ✗ | effect は render の **後** に走るので fiber はもう `null` |
| Node スクリプトで `import { useAuth }` して直接呼ぶ | ✗ | React のレンダラーがそもそも走っていない |
| `it('...', () => useAuth())` で Vitest から直接 | ✗ | 同上。だから次章の `renderHook` が必要 |

「Hook はあくまで `render` の本体 (= 関数コンポーネントが return するまでの間) で呼ぶもの」と覚えるのが分かりやすいです。

---

## 5. カスタムフックは制約を継承する

`useAuth` 自体は構文的にはただの関数ですが、**中で `useContext` を呼ぶ瞬間に同じランタイム制約が乗ります**:

```ts
export const useAuth = () => {
  const context = useContext(AuthContext);  // ← ここで「レンダリング中フラグ」が要る
  // ...
};
```

つまり、

- 「Hook を内部で呼ぶ関数」は「自分も Hook の一種」として扱う必要がある
- `useAuth` の中で更に別のカスタムフック `useFetch` を呼んでも同じ ── 連鎖的に制約が伝播する
- 最終的にコンポーネントから呼ばれていれば、その render 中に `useAuth → useFetch → useState` ... と連鎖して動く

これがカスタムフックを `use` で始める命名規則の理由 (詳細は §7)。

> ひとこと: 「Hook を呼ぶ関数」は「Hook そのもの」と同じ扱い。これがカスタムフックの本質。

---

## 6. テストで `renderHook` が何をしているか

### 6.1 概念図

テストコードでフックを呼ぶには、レンダリング中のコンポーネント fiber が必要 ── でも `it('...', () => useAuth())` のような直接呼び出しでは fiber は `null` で、ランタイムエラーになる。

`renderHook` は **「Hook を裸で呼ばせる抜け道」ではなく、小さなテスト用コンポーネントを 1 個でっちあげて、その render 中に Hook を呼ばせる**仕組みです。「制約の回避」ではなく「**正しい呼び出し環境の提供**」が正確な表現。

### 6.2 `renderHook` の擬似実装

`@testing-library/react` の `renderHook` のおおまかな中身:

```ts
function renderHook(callback, { wrapper: Wrapper } = {}) {
  let result;

  // テスト専用の小さなコンポーネントを 1 個作る
  function TestComponent() {
    result = callback();    // ← React は TestComponent をレンダリング中
    return null;            // ← なので中で Hook が動ける
  }

  // wrapper があれば <Wrapper><TestComponent /></Wrapper> で囲んで render
  const Tree = Wrapper
    ? <Wrapper><TestComponent /></Wrapper>
    : <TestComponent />;

  render(Tree);  // react-dom/test-utils の render で実際にマウント

  return { result: { current: result } };
}
```

これで `currentlyRenderingFiber = testComponentFiber` がセットされた状態で `callback() = useAuth()` が呼ばれ、`useContext` も正しく動きます。

### 6.3 `wrapper` オプションの意味

`useAuth` は `<AuthProvider>` 配下でないと「Provider 無し → `useContext` が `undefined` を返す → useAuth 内の throw が走る」となります (`frontend/src/hooks/useAuth.ts` 参照)。

`renderHook` の `wrapper` オプションで `<AuthProvider>` を渡すと:

```tsx
const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
```

内部の Tree が `<AuthProvider><TestComponent /></AuthProvider>` になり、`useContext(AuthContext)` が valid な値を返すようになります。

### 6.4 実例

本プロジェクトの `frontend/src/hooks/__tests__/useAuth.test.tsx` の抜粋:

```tsx
it('正常系: セッションがあれば User オブジェクトを返す', async () => {
  mockedGetSession.mockResolvedValue({
    data: { user: { id: '42', name: 'Alice', email: '...', image: '...' } },
  } as never);

  // wrapper: AuthProvider で Provider 配下にマウント
  // → useContext(AuthContext) が valid な値を返す
  // → useAuth の throw は走らない
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

  // AuthProvider の useEffect が走り終わるまで待つ
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  expect(result.current.user).toEqual({ id: 42, name: 'Alice', /* ... */ });
});
```

`renderHook` のおかげで、フックを 1 個ずつ単体で検証できる構造になっています。

> ひとこと: `renderHook` は「ダミーコンポーネントを噛ませて、その render 中に Hook を呼ぶ」糖衣。

---

## 7. ESLint と `use` 接頭辞の命名規則

### 7.1 `eslint-plugin-react-hooks` の役割

本プロジェクトの `frontend/package.json` には `eslint-plugin-react-hooks` が devDeps として入っており、ESLint 経由で 2 つのルールが効きます:

| ルール | 何をチェックするか |
|------|------------------|
| `rules-of-hooks` | 条件分岐 / ループ / 通常関数の中で Hook を呼んでいないかを **静的に**検査 |
| `exhaustive-deps` | `useEffect` / `useMemo` / `useCallback` の依存配列の漏れを検知 (本ドキュメントのテーマと別) |

### 7.2 `use` 接頭辞の意義

ESLint は「これは Hook か / 普通の関数か」を **関数名で判断**します:

- `use` で始まる → **カスタムフックと見なす** (中で Hook を呼んでよい)
- それ以外 → 普通の関数と見なす (中で Hook を呼んだら `rules-of-hooks` エラー)

なので「カスタムフックは `use` で始める」のは単なる慣習ではなく、**ESLint との取り決め**です。`useAuth` / `useState` / `useEffect` / `useFetch` ... すべてこの規則に従っています。

### 7.3 ESLint が止めるパターン例

```tsx
// 条件分岐の中で Hook → エラー
function Comp() {
  if (cond) {
    const [x] = useState(0);  // rules-of-hooks エラー (slot index が崩れるため)
  }
}

// 関数名が use で始まらないのに Hook を呼ぶ → エラー
function regularFunction() {
  const ctx = useContext(AuthContext);  // rules-of-hooks エラー
}

// use で始まる = カスタムフックと判定される → OK
function useMyAuth() {
  return useContext(AuthContext);  // OK (呼び出し側がコンポーネントである前提)
}
```

### 7.4 ESLint の限界

ESLint は **静的検査**なので、

- 関数名が `use` で始まれば「コンポーネントから呼ばれる前提」と仮定してしまう
- Node スクリプトから `import { useAuth }` して直接呼んでも ESLint はスルー
- `setTimeout(() => useAuth(), 100)` のように render 後の非同期コールバックから呼ぶケースも検知できない

つまり「実行時にレンダリング中かどうか」までは ESLint では判定不能。**最後の砦はランタイムの `Invalid hook call` エラー**です。

> ひとこと: ESLint は 7 割止めてくれるが、残り 3 割はランタイムで爆発する。テストはランタイムまで含めた検証手段。

---

## 8. まとめ

5 つの結論:

1. **構文上は普通の関数**だが、React Hook はランタイムで「レンダリング中フラグ」を見ている
2. **だからコンポーネント外では呼べない** (= `Invalid hook call`)
3. **カスタムフックも内側で Hook を呼ぶ**ので同じ制約を継承する
4. **`renderHook` はテスト用コンポーネントを 1 個用意して、その render 中に Hook を呼ばせる** ── 制約を回避するのではなく、正しい呼び出し環境を提供する
5. **ESLint は `use` 接頭辞をマーカーに静的検査**するが、最終的なガードはランタイム

「Hook = 関数」というメンタルモデルだけでは説明できない挙動は、React 内部の「レンダリング中フラグ」の存在を補えば全部繋がります。

---

## 関連ドキュメント

- [`frontend-testing-strategy.md`](./frontend-testing-strategy.md) §3.1 — Unit テストにおけるフック扱い
- [`testing-implementation-guide.md`](./testing-implementation-guide.md) §5.6 — 本プロジェクトの `renderHook` 利用例
- [`test-execution-and-ci.md`](./test-execution-and-ci.md) §1.3 — フロントエンドテストの実行コマンド
- `frontend/src/hooks/__tests__/useAuth.test.tsx` — `renderHook` の実例コード (コメント付き)
- React 公式 — [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) (ルールの一次情報)
- React 公式 — [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) (`use` 接頭辞の仕様)
