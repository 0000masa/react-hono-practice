# Vitest リファレンス

このドキュメントは **Vitest 自体** の機能・API・設定オプションを辞書的にまとめた日本語リファレンスです。

- 「Vitest とはどんなライブラリで、どんな API が用意されているか」 → **このドキュメント**
- 「本プロジェクトでは Vitest をどう使っているか / どこに何のテストがあるか」 → [`testing-implementation-guide.md`](./testing-implementation-guide.md)

公式ドキュメント (英語): <https://vitest.dev/>

---

## 1. Vitest とは

Vitest は **Vite ベースのテストランナー** です。Jest と API 互換 (`describe / it / expect / vi.fn` などほぼ同じ書き方) を保ちつつ、Vite と同じトランスパイラ (esbuild) を使うため:

- TypeScript / ESM / JSX をネイティブに扱える (`ts-jest` のような変換層が不要)
- Vite の `resolve.alias` や `plugins` をそのまま流用できる
- 初回起動・ファイル変更時の再ビルドが速い
- `vi.mock` の巻き上げ動作が Jest より直感的

本プロジェクトでは、バックエンド (esbuild + ESM)・フロントエンド (Vite) の双方で採用しています。

| 比較項目 | Vitest | Jest |
|----------|--------|------|
| トランスパイラ | esbuild (Vite と共有) | Babel / ts-jest |
| ESM サポート | ネイティブ | 実験的 (`--experimental-vm-modules`) |
| TypeScript | 設定不要 | `ts-jest` 等が必要 |
| Watch モード | デフォルト (`vitest`) | `--watch` |
| 並列実行 | スレッド / プロセスを選択可 | プロセス |
| ESM の `vi.mock` | ホイスト + ESM 解決を統合 | 制約多め |
| Jest との API 互換 | ほぼ同じ (`vi` を使う点だけ違う) | — |

---

## 2. 動作モデル

```
$ vitest run
  │
  ├─ 1. 設定ファイル (vitest.config.ts / vite.config.ts の test ブロック) を読み込み
  ├─ 2. include パターンに合致するテストファイルを列挙
  ├─ 3. globalSetup (登録があれば) を 1 回実行
  ├─ 4. ワーカー (threads / forks) を起動、ファイルを配分
  │       └─ 各ワーカー内で setupFiles → テスト本体 → teardown
  ├─ 5. 結果を集約してレポート (デフォルトは default reporter)
  └─ 6. 終了コード (失敗が 1 件でもあれば 1)
```

### 2.1 `vitest run` と `vitest` (watch) の違い

| コマンド | 挙動 |
|----------|------|
| `vitest run` | 1 回実行して終了。CI や `npm test` 用 |
| `vitest` / `vitest watch` | 監視モードで起動、ファイル変更があった分だけ再実行 |
| `vitest --ui` | ブラウザ UI を起動。各テストの履歴・ファイル単位の出力を可視化 |

---

## 3. テスト構造 API

### 3.1 `describe` / `it` (= `test`)

```ts
import { describe, it, expect } from 'vitest';

describe('Calculator', () => {
  it('1 + 1 は 2', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- `describe(name, fn)` … テストをグルーピング。ネスト可能。
- `it(name, fn)` … 1 ケース。`test(name, fn)` も同一エイリアス。
- どちらも非同期関数 (`async () => { ... }`) を渡せる。タイムアウトは第 3 引数で指定可能 (`it('...', fn, 5000)`)。

### 3.2 修飾子

| 修飾子 | 効果 |
|--------|------|
| `it.skip(name, fn)` | 実行をスキップ。レポートには "skipped" として残る |
| `it.only(name, fn)` | このテストだけ実行 (他は自動 skip)。**コミット前に外す** |
| `it.todo(name)` | 実装予定マーカー。本文を省ける |
| `it.concurrent(name, fn)` | 同じ describe 内のテストを並列実行 (副作用に注意) |
| `it.fails(name, fn)` | 失敗することを期待。逆 assert 用 |
| `it.runIf(condition)(name, fn)` | 条件が真のときだけ実行 |
| `it.skipIf(condition)(name, fn)` | 条件が真のときスキップ |

`describe.skip` / `describe.only` も同様。

### 3.3 パラメータ化: `it.each` / `describe.each`

```ts
it.each([
  [1, 1, 2],
  [2, 3, 5],
  [10, -3, 7],
])('add(%i, %i) は %i', (a, b, expected) => {
  expect(a + b).toBe(expected);
});
```

- 配列の各要素を引数として渡し、テスト名は `%s` / `%i` / `%d` などのフォーマッタで展開される。
- オブジェクト配列も可: `it.each([{ a: 1, b: 2, want: 3 }])('add($a, $b) is $want', ({ a, b, want }) => { ... })`

---

## 4. ライフサイクルフック

### 4.1 4 種類の基本フック

| フック | 呼ばれるタイミング | スコープ |
|--------|------------------|----------|
| `beforeAll(fn)` | 最初のテストの前に 1 回 | 直近の `describe` (トップレベルならファイル全体) |
| `afterAll(fn)` | 最後のテストの後に 1 回 | 同上 |
| `beforeEach(fn)` | **各テストの前**に毎回 | 直近の `describe` の全 `it` |
| `afterEach(fn)` | **各テストの後**に毎回 | 同上 |

```ts
describe('DB を使うテスト', () => {
  beforeAll(async () => { await connect(); });
  afterAll(async () => { await disconnect(); });
  beforeEach(async () => { await cleanupDb(); });

  it('A', async () => { /* ... */ });
  it('B', async () => { /* ... */ });
});
```

- フックは async OK。`afterAll` の中で `await pool.end()` 等のクリーンアップを忘れると Node プロセスが終わらない (本プロジェクトの実例: [実装ガイド 8.4](./testing-implementation-guide.md#84-poolend-を忘れると-node-プロセスが-hang))。
- ネストした `describe` ではフックも入れ子で動く (外側 → 内側の順に before、内側 → 外側の順に after)。

### 4.2 `globalSetup` と `setupFiles` との使い分け

| 仕組み | 走るタイミング | 走る場所 | 主用途 |
|--------|---------------|----------|--------|
| `globalSetup` | **全テストファイル実行前に 1 回** | 独立した Node プロセス | 実 DB の起動待ち + スキーマ投入、共有リソースの確保 |
| `setupFiles` | **各テストファイルの先頭で毎回** | 各ワーカープロセス | testing-library の DOM 拡張、グローバル `expect` 拡張、共通モック |
| `beforeAll` (テストファイル内) | 当該ファイル先頭で 1 回 | 当該ワーカープロセス | そのファイルでしか使わない準備 |
| `beforeEach` | 各 `it` の直前 | 同上 | DB クリーンアップ、モックリセット |

本プロジェクトでは `globalSetup` を [`backend/src/__tests__/global-setup.ts`](../../../backend/src/__tests__/global-setup.ts) で使い、テスト用 MySQL のスキーマを初期化しています。

---

## 5. アサーション (`expect`)

すべてのアサーションは `expect(actual).matcher(expected)` の形を取り、失敗するとそのテストが fail します。

### 5.1 等価系

| マッチャ | 用途 | 補足 |
|----------|------|------|
| `toBe(value)` | プリミティブの厳密等価 (`===`) | オブジェクトは参照同一性なので不向き |
| `toEqual(value)` | **構造的に**等しいか (再帰的に比較) | `undefined` のプロパティは無視 |
| `toStrictEqual(value)` | `toEqual` より厳しい | `undefined` プロパティ・クラス型の違いも検出 |

```ts
expect(2 + 2).toBe(4);
expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
```

### 5.2 真偽 / null / undefined

| マッチャ | 期待値 |
|----------|--------|
| `toBeTruthy()` | 真値 |
| `toBeFalsy()` | 偽値 |
| `toBeNull()` | `=== null` |
| `toBeUndefined()` | `=== undefined` |
| `toBeDefined()` | `!== undefined` |

### 5.3 数値

| マッチャ | 用途 |
|----------|------|
| `toBeGreaterThan(n)` / `toBeGreaterThanOrEqual(n)` | `>` / `>=` |
| `toBeLessThan(n)` / `toBeLessThanOrEqual(n)` | `<` / `<=` |
| `toBeCloseTo(n, digits?)` | 浮動小数の誤差を許容 (`0.1 + 0.2` の比較に必須) |
| `toBeNaN()` | `Number.isNaN(actual)` |

### 5.4 文字列

| マッチャ | 用途 |
|----------|------|
| `toMatch(regex \| string)` | 正規表現または部分文字列にマッチ |
| `toContain(substring)` | 部分文字列を含む |

```ts
expect('hello world').toMatch(/world/);
expect('<h2>Subject-A</h2>').toMatch(/<h2[^>]*>Subject-A<\/h2>/);
```

### 5.5 配列 / オブジェクト

| マッチャ | 用途 |
|----------|------|
| `toHaveLength(n)` | `array.length === n` (文字列にも使える) |
| `toContain(item)` | 要素を含む (`===` 比較) |
| `toContainEqual(item)` | 要素を含む (`toEqual` 比較、オブジェクト要素に有効) |
| `toMatchObject(partial)` | オブジェクトの一部キーが一致 |
| `toHaveProperty(path, value?)` | ネスト下のキー存在 / 値を検査 (`'user.name'`) |

```ts
expect([{ id: 1 }, { id: 2 }]).toContainEqual({ id: 1 });
expect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, b: 2 });
```

### 5.6 例外

| マッチャ | 用途 |
|----------|------|
| `toThrow()` | 何らかの throw |
| `toThrow(message \| regex \| ErrorClass)` | メッセージ / 型を検査 |
| `toThrowError(...)` | `toThrow` のエイリアス |

```ts
expect(() => parseConfig('')).toThrow(/empty/);
expect(() => parseConfig('')).toThrow(ValidationError);
```

### 5.7 非同期 (`.resolves` / `.rejects`)

```ts
await expect(fetchUser(1)).resolves.toEqual({ id: 1, name: 'a' });
await expect(fetchUser(-1)).rejects.toThrow('not found');
```

- 必ず `await` を付ける。**`await` を忘れると assert が走らずテストが通ったように見える**。
- 単純な await 後の expect でも書ける: `const u = await fetchUser(1); expect(u).toEqual(...)`。

### 5.8 モック検証

| マッチャ | 用途 |
|----------|------|
| `toHaveBeenCalled()` | 1 回以上呼ばれた |
| `toHaveBeenCalledTimes(n)` | ちょうど n 回呼ばれた |
| `toHaveBeenCalledOnce()` | ちょうど 1 回 |
| `toHaveBeenCalledWith(...args)` | 引数完全一致で呼ばれた (どの呼び出しでも 1 回でも該当すれば OK) |
| `toHaveBeenLastCalledWith(...args)` | 最後の呼び出しの引数を検査 |
| `toHaveBeenNthCalledWith(n, ...args)` | n 回目の呼び出しの引数を検査 |
| `toHaveReturnedWith(value)` | 戻り値の検査 |
| `toHaveReturnedTimes(n)` | 戻り値ありで n 回 |

```ts
expect(mockedFn).toHaveBeenCalledOnce();
expect(mockedFn).toHaveBeenCalledWith('expected-arg', expect.any(Number));
```

### 5.9 修飾子・補助

| 形 | 用途 |
|----|------|
| `expect(x).not.toBe(...)` | 否定 |
| `expect.any(Constructor)` | 値が何でも良い (型だけ検査): `expect.any(Number)` |
| `expect.anything()` | `null` / `undefined` 以外の任意 |
| `expect.objectContaining({ ... })` | 一部キー一致 |
| `expect.arrayContaining([...])` | 一部要素を含む |
| `expect.stringContaining('xxx')` | 文字列に部分一致 |
| `expect.stringMatching(/regex/)` | 文字列に正規表現一致 |
| `expect.closeTo(n, digits?)` | 数値の誤差許容 |
| `expect.assertions(n)` | このテストで n 回の assert が走ったことを保証 (非同期テスト用) |
| `expect.hasAssertions()` | 少なくとも 1 回 assert が走ったことを保証 |

```ts
expect(mockedFn).toHaveBeenCalledWith(expect.objectContaining({
  from: 'sender@example.com',
  to: expect.any(String),
}));
```

### 5.10 スナップショット

| マッチャ | 用途 |
|----------|------|
| `toMatchSnapshot()` | 値を別ファイル (`__snapshots__/...`) に保存し、次回以降は差分検査 |
| `toMatchInlineSnapshot(\`...\`)` | スナップショットをテストコード内に展開 |
| `toMatchFileSnapshot(path)` | 指定ファイルに保存 |

UI 出力や複雑なオブジェクトのリグレッション検出に便利。更新するときは `vitest --update` (または `-u`)。

---

## 6. モック (`vi`)

### 6.0 `vi` とは / `vi.fn()` と `vi.mock()` の違い

`vi` は **Vitest が提供するモック / スパイ / タイマー / 環境変数操作の名前空間** (1 個のオブジェクト) です。Jest における `jest` 名前空間と同じ立ち位置で、`import { vi } from 'vitest'` で取り込みます。
`vi.fn()` / `vi.mock()` / `vi.spyOn()` / `vi.useFakeTimers()` などのメソッドはすべてこの `vi` にぶら下がっています。

#### `vi.fn()` と `vi.mock()` は名前が似ているが別物

| 関数 | 操作対象 | 戻り値 / 効果 |
|------|----------|---------------|
| `vi.fn(impl?)` | **1 個の関数を作る** | 呼び出し履歴を記録する「偽の関数」を返す |
| `vi.mock(modulePath, factory?)` | **モジュール全体を差し替える** | 戻り値なし。副作用としてモジュール解決を書き換える |

両者の関係を一言で言うと、`vi.mock` の [factory](#123-factory-ファクトリ関数) が **「モジュールが何を export しているか」** の定義で、その中で個々の関数を差し替えたいときに `vi.fn()` が登場します:

```ts
vi.mock('../config/mail', () => ({  // ← vi.mock: モジュール丸ごとの差し替え
  sendEmail: vi.fn(),                // ← vi.fn: その中の 1 関数
}));
```

#### 「`vi.fn()` は呼び出し回数を返す関数」という理解は **誤り**

`vi.fn()` が返すのは「呼び出し回数を返す関数」ではなく、**「呼ばれた事実を内部に記録する、ただの空の関数」** です。実体はこんなイメージ:

```ts
const fn = vi.fn();    // fn は (...args) => undefined のような関数

const r1 = fn('hello'); // r1 === undefined (デフォルトでは何も返さない)
const r2 = fn(42);      // r2 === undefined
// ↑ 戻り値は undefined だが、内部に { calls: [['hello'], [42]] } が蓄積されている

// 履歴は .mock プロパティで参照する
fn.mock.calls;          // [['hello'], [42]]
fn.mock.calls.length;   // 2   ← 呼び出し回数はここで取れる

// テスト中はマッチャ経由で検証するのが定石
expect(fn).toHaveBeenCalledTimes(2);
expect(fn).toHaveBeenCalledWith('hello');
```

##### よくある疑問 — `vi.fn()` 周りの Q&A

**Q1. `fn('hello')` の `'hello'` は `vi.fn()` の `()` に自動で渡される?**

**いいえ。** `vi.fn()` の呼び出しと `fn(...)` の呼び出しは **完全に別物** です。

- `vi.fn()` は引数なしで呼ばれていて、これは **「呼ばれた事実を記録するカラの関数」を 1 個作って返す** という意味。
- その戻り値を `fn` という変数に格納した後、`fn('hello')` は **作った関数を 'hello' という引数で呼んでいる** だけ。

時系列で書くとこう:

```ts
const fn = vi.fn();    // (1) Vitest が空の関数を 1 個作る。fn にその関数を代入。
                       //     fn.mock.calls === []
fn('hello');           // (2) fn を 'hello' で呼ぶ。
                       //     裏で Vitest が記録: fn.mock.calls === [['hello']]
                       //     戻り値: undefined
fn(42);                // (3) fn を 42 で呼ぶ。
                       //     裏で Vitest が記録: fn.mock.calls === [['hello'], [42]]
                       //     戻り値: undefined
```

**Q2. `fn('hello')` や `fn(42)` は「何もしない関数」に引数を渡しているだけ?**

**ほぼその通り。ただし "呼ばれたことの記録" だけは裏で動いている。**

- 表向き: 戻り値は `undefined`、副作用なし、本物の `sendEmail` のように外部 API を叩いたりしない。
- 裏側: 呼ばれた瞬間に「いつ・どんな引数で・何を返したか」が `fn.mock.*` プロパティに追記される。

この「**カラだけど、呼ばれたことだけは覚えている**」性質が、テストにおける「本物の関数の代役 (モック)」として機能する所以です。

**Q3. なぜ `mock.calls` は `[['hello'], [42]]` (二重配列)? `['hello', 42]` じゃダメ?**

**1 回の呼び出しが複数の引数を持ちうるから**、二重配列になっています。
具体例:

```ts
const fn = vi.fn();
fn('hello');           // 引数 1 個
fn(42);                // 引数 1 個
fn('a', 'b', 'c');     // 引数 3 個

fn.mock.calls;
// [
//   ['hello'],         ← 1 回目の呼び出しの引数たち (1 要素)
//   [42],              ← 2 回目の呼び出しの引数たち (1 要素)
//   ['a', 'b', 'c'],   ← 3 回目の呼び出しの引数たち (3 要素)
// ]

fn.mock.calls.length;   // 3 = 呼び出し回数
fn.mock.calls[2];       // ['a', 'b', 'c'] = 3 回目の引数並び
fn.mock.calls[2][1];    // 'b' = 3 回目の 2 番目の引数
```

つまり:

| 配列の階層 | 表しているもの |
|------------|----------------|
| **外側** (`calls[i]`) | 呼び出し履歴の `i` 回目 |
| **内側** (`calls[i][j]`) | その呼び出しの `j` 番目の引数 |

もし仮にフラットな `['hello', 42]` 形式だったら、「`fn('hello', 42)` を 1 回呼んだ」のか「`fn('hello')` と `fn(42)` を別々に呼んだ」のか区別できません。なので「**呼び出し 1 回 = 引数の配列 1 個**」というルールで設計されています。

**Q4. `expect(fn).toHaveBeenCalledWith('hello')` は「`fn` を 'hello' で呼ぶことを予測する」という意味?**

**「予測」ではなく「事後検証 (assertion)」** です。

- このテストコードが走るのは、上で `fn('hello')` などが既に実行された **後** のタイミング。
- `toHaveBeenCalledWith('hello')` は過去形で「ここまでの呼び出し履歴の中に、引数が `'hello'` ちょうど 1 個だった呼び方が **少なくとも 1 回** あったか?」を確認する。
- マッチすればテストが pass、しなければ fail (= 期待していた呼び方がされていなかったというバグ通知になる)。

雰囲気としてはこう:

```ts
const fn = vi.fn();

// ──── ① まず実コードを動かす ────
fn('hello');
fn(42);

// ──── ② その後で「履歴を検査」する ────
expect(fn).toHaveBeenCalledWith('hello');  // ✅ pass (1 回目が一致)
expect(fn).toHaveBeenCalledWith(42);       // ✅ pass (2 回目が一致)
expect(fn).toHaveBeenCalledWith('xyz');    // ❌ fail (そんな呼ばれ方はしていない)
```

実装的には、`expect(fn).toHaveBeenCalledWith('hello')` は内部で `fn.mock.calls` を見て「`['hello']` と一致する要素があるか?」を線形検索しているだけ。つまり [6.2 節](#62-呼び出し履歴の検査) で生の `fn.mock.calls` を見るのと同じことを、**読みやすいマッチャの形** で書いているだけです。

**戻り値は後から設定できる** ので、「呼ばれたかを記録するだけ」のミニマム用途から、「特定の値を返すスタブ」まで同じ `vi.fn()` で表現できます:

```ts
const fn = vi.fn();
fn.mockReturnValue(99);
fn();                                  // 99 が返る

const asyncFn = vi.fn().mockResolvedValue('ok');
await asyncFn();                       // 'ok' が返る

const impl = vi.fn((a: number, b: number) => a + b);
impl(2, 3);                            // 5 (任意の実装で動かす)
```

まとめると `vi.fn()` は **「呼ばれた事実を記録する + 戻り値や実装を後付けで決められる、空の関数を 1 個作るユーティリティ」**。
「呼び出し回数を取る」のは結果の一側面に過ぎず、`vi.fn()` 自体の役割ではありません。

#### `vi.mock()` は「ファイルを処理に差し替える」より「モジュール解決を乗っ取る」が正確

第 1 引数は **ファイルパスではなくモジュール指定子** (`import 'xxx'` の `'xxx'` の部分)。これに合致する import が発生したとき、本物のファイルを読まずに **第 2 引数の factory が返したオブジェクトを「そのモジュールの exports」として返します**。

```ts
vi.mock('../config/mail', () => ({   // ← '../config/mail' を import すると
  sendEmail: vi.fn(),                 //    ここで返したオブジェクトが受け取れる
  MAIL_TIMEOUT: 3000,                 //    変数も入れられる
}));

import { sendEmail, MAIL_TIMEOUT } from '../config/mail';
// sendEmail は上の vi.fn()、MAIL_TIMEOUT は 3000
```

ポイント:

- factory が返すオブジェクトのキー = **そのモジュールが export していることになる名前**。
- factory は **省略可能**。省略すると本物のモジュールを参考に全 export が自動的に `vi.fn()` 化される (auto-mock)。
- 「処理を差し替える」と言うより「**何を import させるか** を差し替える」と捉えるのが正確。差し替え先は関数だけでなく定数・クラス・オブジェクトでも何でも良い。
- パスはコード中の `import` と同じ書き方を渡す (相対パス・エイリアス・パッケージ名のいずれも可)。
- `vi.mock` 自体は **ホイストされて import より先に実行される** ので、上のコードのように import より下に書いても効く ([12.2 節](#122-ホイスト-hoist--hoisting) 参照)。

詳しい使い方は [6.1 vi.fn()](#61-関数モック-vifn) と [6.3 vi.mock()](#63-モジュールモック-vimock) を参照してください。

### 6.1 関数モック: `vi.fn()`

```ts
const cb = vi.fn();
cb('hello');
cb(42);

expect(cb).toHaveBeenCalledTimes(2);
expect(cb.mock.calls[0][0]).toBe('hello');
```

戻り値・実装の設定 — 早見表:

| メソッド | 効果 |
|----------|------|
| `mockReturnValue(v)` | 同期で `v` を返す |
| `mockReturnValueOnce(v)` | 次の 1 回だけ `v`、その後は元の挙動 |
| `mockResolvedValue(v)` | `Promise.resolve(v)` を返す (非同期版) |
| `mockResolvedValueOnce(v)` | 次の 1 回だけ Promise.resolve(v) |
| `mockRejectedValue(e)` | `Promise.reject(e)` を返す (エラー版) |
| `mockRejectedValueOnce(e)` | 次の 1 回だけ Promise.reject(e) |
| `mockImplementation(fn)` | 任意の関数で全置換 |
| `mockImplementationOnce(fn)` | 次の 1 回だけ別の実装 |
| `mockName(name)` | 失敗メッセージで識別しやすい名前を付ける |

以下、各メソッドを詳しく:

##### `mockReturnValue(v)` — 同期で値を返すスタブ

呼ばれたら毎回 `v` を返すように実装を差し替える。同期関数のスタブを作るときの基本形。

```ts
const getCount = vi.fn();
getCount.mockReturnValue(42);

getCount();          // 42
getCount();          // 42 (何度呼んでも同じ)
getCount('x', 'y');  // 42 (引数は無視される)
```

戻り値が差し替わっても `mock.calls` への呼び出し履歴記録は続く。

##### `mockReturnValueOnce(v)` — 次の 1 回だけ値を返す

呼ばれるたびに「キュー」から 1 つずつ取り出して返す。複数回呼んで戻り値を順に切り替えたいときに使う。キューが空になったら `mockReturnValue` の値、それも無ければ `undefined` に戻る。

```ts
const next = vi.fn();
next.mockReturnValueOnce('a').mockReturnValueOnce('b');

next();  // 'a'
next();  // 'b'
next();  // undefined (キュー枯渇)
```

`mockReturnValue` と組み合わせると「フォールバック付き」にできる:

```ts
next.mockReturnValue('default');
next.mockReturnValueOnce('first');

next();  // 'first'
next();  // 'default'
next();  // 'default'
```

##### `mockResolvedValue(v)` — `Promise.resolve(v)` を返す (非同期版)

呼ばれたら `Promise.resolve(v)` を返すように実装を差し替える。await すると `v` が取り出せる Promise を返す関数になる。

**`Promise.resolve(v)` とは**: 「**`v` という値で fulfilled (成功) 状態にすぐ確定する Promise を作る組み込み関数**」。普通の `new Promise((resolve, reject) => { ... })` は内部で非同期処理を書いた後 `resolve(v)` を呼ぶ必要があるが、`Promise.resolve(v)` は「もう成功は確定している」という Promise を 1 行で作れる便利な書き方。

```ts
Promise.resolve(42);          // 即座に fulfilled な Promise<number>
await Promise.resolve(42);    // 42 (await すると中身が取れる)
```

`mockResolvedValue(v)` は概念的にはこれと同じ:

```ts
fn.mockResolvedValue(v);
// ≡
fn.mockImplementation(() => Promise.resolve(v));
```

使用例:

```ts
const fetchUser = vi.fn();
fetchUser.mockResolvedValue({ id: 1, name: 'Alice' });

const u = await fetchUser(1);   // { id: 1, name: 'Alice' }
```

本プロジェクトの `mail.service.test.ts` の `beforeEach` で `mockedSendEmail.mockResolvedValue(undefined)` を使っているのがまさにこれ。本物の `sendEmail` は `Promise<void>` を返す API なので、テスト中は「成功して何も返さない Promise」で代用している。

##### `mockResolvedValueOnce(v)` — 次の 1 回だけ `Promise.resolve(v)`

`mockReturnValueOnce` の Promise 版。「1 回目だけ違う値を返したい」「複数回で順に違うレスポンスをモックしたい」などに使う。

```ts
fetchUser
  .mockResolvedValueOnce({ id: 1, name: 'first' })
  .mockResolvedValueOnce({ id: 2, name: 'second' });

await fetchUser();  // { id: 1, name: 'first' }
await fetchUser();  // { id: 2, name: 'second' }
```

##### `mockRejectedValue(e)` — `Promise.reject(e)` を返す (エラー版)

呼ばれたら `Promise.reject(e)` を返すように差し替える。await すると `e` が throw される Promise を返す関数になる。

**`Promise.reject(e)` とは**: 「**`e` というエラーで rejected (失敗) 状態にすぐ確定する Promise**」。エラーケースのモックを 1 行で作れる。

```ts
const fetchUser = vi.fn();
fetchUser.mockRejectedValue(new Error('not found'));

await fetchUser(1);  // throw: Error('not found')

// テストで使うときの典型形
await expect(fetchUser(1)).rejects.toThrow('not found');
```

本プロジェクトの `mail.service.test.ts` ケース 3 (「`sendEmail` がエラーを投げたら呼び出し元へ伝播する」) で `mockedSendEmail.mockRejectedValue(new Error('SMTP down'))` を使っているのがこの形。

##### `mockRejectedValueOnce(e)` — 次の 1 回だけエラーを投げる

「1 回目は失敗、2 回目は成功」のようなリトライロジックのテストで便利。

```ts
fetchUser
  .mockRejectedValueOnce(new Error('timeout'))
  .mockResolvedValue({ id: 1, name: 'Alice' });

await fetchUser();   // throw: timeout
await fetchUser();   // { id: 1, name: 'Alice' }
```

##### `mockImplementation(fn)` — 任意の関数で全置換

`mockReturnValue` は「固定値を返す」だけだが、こちらは **戻り値も挙動も自由に書ける**。引数によって戻り値を変えたい場合や、副作用を入れたい場合に使う。

```ts
const add = vi.fn();
add.mockImplementation((a: number, b: number) => a + b);

add(2, 3);    // 5
add(10, -1);  // 9
```

実は `vi.fn(impl)` のように `vi.fn()` に直接実装を渡すのは、これと等価:

```ts
const add = vi.fn((a: number, b: number) => a + b);
// ≡
const add = vi.fn();
add.mockImplementation((a, b) => a + b);
```

##### `mockImplementationOnce(fn)` — 次の 1 回だけ別の実装

`mockImplementation` の「1 回だけ」版。1 回目だけエラーを投げる、特殊な値を返す、などに使う。

```ts
const handler = vi.fn();
handler.mockImplementationOnce(() => { throw new Error('crash'); });
handler.mockImplementation(() => 'ok');

handler();  // throw: crash
handler();  // 'ok'
handler();  // 'ok'
```

##### `mockName(name)` — 失敗メッセージ用の名前を付ける

デバッグ用。テスト失敗時の Vitest のエラーメッセージに表示される「モックの名前」を設定する。

```ts
const fn = vi.fn().mockName('sendEmail');
```

何も設定しないと失敗メッセージは `expected "spy" to be called` のように `"spy"` という汎用名になり、複数モックがある場合にどれが原因か追いにくい。`mockName('sendEmail')` を付けておくと `expected "sendEmail" to be called` のように表示されて識別しやすくなる。挙動には影響しない、純粋にデバッグ補助。

### 6.2 呼び出し履歴の検査

| プロパティ | 内容 |
|------------|------|
| `fn.mock.calls` | `Array<引数配列>` (例: `mock.calls[0][1]` = 1 回目の 2 番目の引数) |
| `fn.mock.results` | `Array<{ type: 'return'\|'throw', value }>` |
| `fn.mock.instances` | `new` で呼ばれた場合の `this` 一覧 |
| `fn.mock.lastCall` | 最後の呼び出しの引数配列 |

### 6.3 モジュールモック: `vi.mock()`

```ts
vi.mock('../config/mail', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../config/mail';  // ← 上で差し替えた版が読まれる
```

- `vi.mock(path, factory?)` は **ファイル先頭にホイストされる** (Vitest のトランスフォーマーが自動で行う)。物理的な行が import より下にあっても、実行時には import より先に走る。
- factory を省略すると、対象モジュールの全 export が自動的に `vi.fn()` で置換される (auto-mock)。
- パスは **import するときと同じ書き方** を渡す (`../foo`, `@/lib/bar`, パッケージ名 `'qrcode'` など)。

### 6.4 部分モック: `vi.importActual()`

「特定の関数だけ差し替えて、それ以外は本物を使いたい」場合:

```ts
vi.mock('../config/mail', async () => {
  const actual = await vi.importActual<typeof import('../config/mail')>('../config/mail');
  return {
    ...actual,
    sendEmail: vi.fn(),  // sendEmail だけモック、他は本物
  };
});
```

### 6.5 `vi.doMock()` (ホイストしない版)

`vi.doMock()` は **巻き上げが起こらない** バージョン。テストの途中でモック内容を切り替えたい場合に使う。代わりに、対象モジュールはモック宣言の **後で動的 import** する必要がある。

```ts
beforeEach(() => {
  vi.doMock('./flag', () => ({ enabled: true }));
});

it('動的 import', async () => {
  const { runIfEnabled } = await import('./feature');
  // ...
});
```

### 6.6 スパイ: `vi.spyOn()`

`vi.spyOn(obj, methodName)` は **既に存在するオブジェクトのメソッドを "ラップ" して**、呼び出し履歴を取れるようにするユーティリティ。

#### 「実装は本物のまま」とはどういう意味?

`vi.fn()` や `vi.mock()` が「**処理を差し替える**」のに対し、`vi.spyOn()` のデフォルトは「**本物の処理はそのまま残して、呼ばれた事実だけ横で記録する**」動きをする。スパイを呼ぶと本物のメソッドが普通に実行され、戻り値も本物のもの。横で `mock.calls` に追記する分が増えただけ。

```ts
const spy = vi.spyOn(console, 'log');

console.log('hello');  // ターミナルに "hello" と実際に出力される (本物が動いている)
console.log('world');  // ターミナルに "world" と実際に出力される

expect(spy).toHaveBeenCalledTimes(2);          // 履歴は取れている
expect(spy).toHaveBeenCalledWith('hello');     // 引数の検証もできる

spy.mockRestore();   // 後始末 — 本物のメソッドに戻す
```

仮に `vi.fn()` で `console.log = vi.fn()` のように丸ごと差し替えると「ログがそもそも出ない」状態になるが、`vi.spyOn` なら **「ログは出るし、呼ばれたかも検証できる」** — これが「実装は本物のまま」の意味。

#### `vi.spyOn(console, 'log')` の引数の意味

```ts
vi.spyOn( console , 'log' )
//        ^^^^^^^   ^^^^^
//        ①         ②
```

| 引数 | 意味 |
|------|------|
| ① 第 1 引数 `console` | 対象のメソッドを**持っている**オブジェクト |
| ② 第 2 引数 `'log'` | そのオブジェクトの**どのメソッド**をスパイするか (文字列) |

つまり「`console` というオブジェクトの `log` というプロパティ (=メソッド) を見張れ」という指示。内部的にはこんなイメージで動いている:

```ts
// 概念コード
const original = console.log;            // (1) 本物のメソッドを退避
console.log = function spied(...args) {  // (2) console.log をラッパーに置き換え
  recordCall(args);                       //     呼ばれたら履歴に追加
  return original.apply(console, args);   //     本物を呼んで戻り値を返す
};
```

ポイント:
- `console.log` プロパティ自体は **スパイ関数に置き換わっている** が、その中で本物を呼ぶので利用者から見ると挙動が変わらない。
- `spy.mockRestore()` を呼ぶと `console.log` を **退避していた本物に戻す**。これを忘れると次のテストにも影響することがあるので、`afterEach(() => spy.mockRestore())` か config の `restoreMocks: true` を入れておくのが安全。

#### `vi.fn` / `vi.mock` / `vi.spyOn` の使い分け

| API | 何を作る / 操作する? | 本物の処理 | 用途例 |
|-----|----------------------|------------|--------|
| `vi.fn()` | 新しい関数を 1 個ゼロから作る | (本物は存在しない) | コールバック引数、モジュールモックの中身 |
| `vi.spyOn(obj, 'x')` | 既存メソッド `obj.x` をラップする | **デフォルトで本物が動く** | `console.log` 検証、`Date.now` 監視、インスタンスメソッドの監視 |
| `vi.mock(path)` | モジュール全体を差し替える | 全 export がモック化される | サービス層 / 外部 API のモジュールごとモック |

#### 本物の挙動を上書きしたい場合

`vi.spyOn` が返すスパイは `vi.fn()` と同じインターフェースを持つので、後から `mockReturnValue` / `mockImplementation` / `mockResolvedValue` などを呼べば、本物の動作を抑制して任意の挙動に差し替えられる:

```ts
const spy = vi.spyOn(console, 'log');
spy.mockImplementation(() => {});  // 何も出力しないように上書き

console.log('hello');              // ターミナルには何も表示されない
expect(spy).toHaveBeenCalledWith('hello'); // でも履歴は取れている

spy.mockRestore();
console.log('world');              // 復元後はターミナルに出る
```

#### よくある用途

| 場面 | コード例 |
|------|---------|
| `console.log` の呼ばれ方を検証したい | `vi.spyOn(console, 'log')` |
| 警告ログが出ていないことを assert | `const spy = vi.spyOn(console, 'warn'); ...; expect(spy).not.toHaveBeenCalled()` |
| `Date.now()` を固定値にしたい | `vi.spyOn(Date, 'now').mockReturnValue(1700000000000)` |
| `Math.random()` を固定したい | `vi.spyOn(Math, 'random').mockReturnValue(0.5)` |
| あるクラスインスタンスのメソッドだけ差し替え | `vi.spyOn(myService, 'fetchUser').mockResolvedValue({ ... })` |

#### 後始末

`vi.spyOn` の後始末は `spy.mockRestore()` または `vi.restoreAllMocks()` ([6.10 節](#610-状態リセット--3-種類の使い分け))。
**`vi.clearAllMocks()` / `clearMocks: true` では "本物への復元" はされない** ので、`vi.spyOn` を使うときは `restoreMocks: true` を有効にしておくか、明示的に `mockRestore()` を呼ぶのが安全。

### 6.7 型付け: `vi.mocked()` — `vi.mock()` との違い

名前が 1 文字違い (`mock` と `mocked`) のため最も混同されやすいペア。**役割は全く別物** です。

#### 一言で言うと

| 関数 | 役割 | 動作するレイヤー |
|------|------|------------------|
| `vi.mock(path, factory?)` | **モジュールの中身を実体として差し替える** | ランタイム (実行時の挙動を変える) |
| `vi.mocked(fn)` | **既にモック化済みの関数に "モックです" という型情報だけを付け直す** | TypeScript の型レベルだけ (ランタイムは何もしない) |

`vi.mocked()` は **TypeScript のための補助ユーティリティ** であり、JavaScript としては「**渡された関数をそのまま返すだけ**」の 1 行関数です。実体としてのモック化は `vi.mock()` が既に済ませている前提。

#### 詳しい比較

| | `vi.mock()` | `vi.mocked()` |
|---|-------------|---------------|
| 引数 | モジュールパス (+ factory) | モック化済みの関数や値 |
| 戻り値 | なし (副作用のみ) | 渡された値そのもの (型だけ変わる) |
| ランタイムでの動作 | モジュール解決を書き換える | **何もしない** (型キャストのみ) |
| ホイスト | **される** ([12.2 節](#122-ホイスト-hoist--hoisting)) | されない (普通の関数呼び出し) |
| 呼ぶ場所 | テストファイルのトップレベル | テスト本体のどこでも (通常は import の後) |
| 必要性 | モックの成立に必須 | 純粋に補助。**消してもテストは動く** (ただし型エラー / 補完なしになる) |

#### なぜ両方必要なのか — 実例

TypeScript で `vi.mock()` だけを使うと、こういう状況になります:

```ts
vi.mock('../config/mail', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from '../config/mail';

// ランタイム: sendEmail は vi.fn() なので mockResolvedValue が存在する。
// しかし TypeScript の型: 元の sendEmail (本物の関数の型) のまま。
sendEmail.mockResolvedValue(undefined);
// ❌ Property 'mockResolvedValue' does not exist on type
//    '(to: string, subject: string, body: string) => Promise<void>'
```

なぜ型が変わらないか: `vi.mock` は **ランタイムの解決だけを書き換える** ので、コード上に書かれた `import { sendEmail } from '../config/mail'` の型 (= 本物のシグネチャ) は元のままだから。

ここで `vi.mocked()` を使うと型だけが付け直されます:

```ts
import { sendEmail } from '../config/mail';
const mockedSendEmail = vi.mocked(sendEmail);
//                       ↑
//   ランタイム: sendEmail と全く同じ関数を返すだけ
//   型レベル:   MockedFunction<typeof sendEmail> として扱われる

mockedSendEmail.mockResolvedValue(undefined);  // ✅ 型補完が効く
mockedSendEmail.mock.calls;                    // ✅ 同上
expect(mockedSendEmail).toHaveBeenCalledOnce(); // ✅ 型もチェックも通る
```

`vi.mocked` の実装は概念的にはこれだけ:

```ts
function mocked<T>(value: T): MockedFunction<T> {
  return value as unknown as MockedFunction<T>;  // 型キャストだけ
}
```

つまり JavaScript としては実質 **`as` 型アサーション** と等価。Vitest 公式の型付けに沿ったキャストヘルパ、というのが正体。

#### よくある間違い

```ts
// ❌ vi.mocked() だけでは、モックは成立しない
import { sendEmail } from '../config/mail';
const m = vi.mocked(sendEmail);
m.mockResolvedValue(undefined);  // ランタイムエラー!
//   本物の sendEmail には mockResolvedValue は無いので落ちる
```

→ `vi.mock()` を先に書かないと、`sendEmail` は依然として本物の関数。**`vi.mocked()` は単独では使えない**。

```ts
// ✅ 正しい組み合わせ
vi.mock('../config/mail', () => ({
  sendEmail: vi.fn(),                          // ← (1) ランタイムでモック化
}));

import { sendEmail } from '../config/mail';
const mockedSendEmail = vi.mocked(sendEmail);  // ← (2) 型を付け直すだけ

mockedSendEmail.mockResolvedValue(undefined);  // ✅ 両方揃って初めて動く
```

#### 命名の覚え方

英語の文法を意識すると見分けやすい:

- **`vi.mock`** (動詞・能動形) — 「モック化する」という **動作**
- **`vi.mocked`** (過去分詞) — 「もうモック化された (関数)」を **型として認める**

JavaScript としては別物ですが、英語としては「動作 vs 状態」の関係になっています。

### 6.8 巻き上げが必要な変数: `vi.hoisted()`

`vi.mock` のファクトリ関数の中では、テストファイル冒頭の `const` などは参照できない (ホイスト先で未定義になる)。
これを回避するのが `vi.hoisted()`:

```ts
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('../config/mail', () => ({
  sendEmail: mocks.send,  // ← vi.mock より先に評価される
}));

mocks.send.mockResolvedValue(undefined);
```

### 6.9 グローバル / 環境変数

| API | 用途 |
|-----|------|
| `vi.stubGlobal(name, value)` | `globalThis[name]` を一時的に差し替え (`fetch`, `localStorage` 等) |
| `vi.unstubAllGlobals()` | 差し替えを全部戻す (`afterEach` で呼ぶ慣例) |
| `vi.stubEnv(key, value)` | `process.env[key]` を差し替え (Vite では `import.meta.env` も) |
| `vi.unstubAllEnvs()` | 環境変数を全部戻す |

```ts
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
```

`config` で `unstubGlobals: true` / `unstubEnvs: true` を入れておけば、`afterEach` を書かなくても自動で復元される。

### 6.10 状態リセット — 3 種類の使い分け

| 関数 / config キー | リセット対象 | 残るもの |
|--------------------|--------------|----------|
| `vi.clearAllMocks()` / `clearMocks: true` | 呼び出し履歴 (`mock.calls` / `results` / `instances`) | **実装** (`mockReturnValue` 等) |
| `vi.resetAllMocks()` / `resetMocks: true` | 履歴 + 実装 (引数なし `vi.fn()` に戻す) | — |
| `vi.restoreAllMocks()` / `restoreMocks: true` | 履歴 + 実装 + **`vi.spyOn` で奪った元実装を戻す** | — |

「`mockResolvedValue` が次のテストに漏れない方が良い」 → `resetMocks: true`
「`vi.spyOn` の後始末も自動でやってほしい」 → `restoreMocks: true`

本プロジェクトは `clearMocks: true` のみを使っているため、`beforeEach` で `mockedSendEmail.mockResolvedValue(undefined)` のように **実装を毎回張り直す** スタイル ([実装ガイド 5.1 〜 5.2](./testing-implementation-guide.md#5-テスト種別ごとの書き方-実例) 参照)。

---

## 7. タイマー操作

時間に依存するコード (`setTimeout` / `setInterval` / `Date.now()`) を制御するためのモック。

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('1 秒後に呼ばれる', () => {
  const cb = vi.fn();
  setTimeout(cb, 1000);

  expect(cb).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(cb).toHaveBeenCalled();
});
```

| API | 効果 |
|-----|------|
| `vi.useFakeTimers()` | 偽タイマーに切り替え (時間が進まなくなる) |
| `vi.useRealTimers()` | 元に戻す |
| `vi.advanceTimersByTime(ms)` | 指定ミリ秒だけ進める |
| `vi.advanceTimersToNextTimer()` | 次の予約まで進める |
| `vi.runAllTimers()` | すべての予約を順に実行 |
| `vi.runOnlyPendingTimers()` | 現時点で予約済みのものだけ実行 (実行中に予約された新規 timer は無視) |
| `vi.setSystemTime(date)` | `Date.now()` / `new Date()` の基準時刻を固定 |
| `vi.getMockedSystemTime()` | 設定済みの偽時刻を取得 |

オプション付き fake timers (`{ shouldAdvanceTime: true }` 等) も指定できるが、多くの場合はデフォルトで十分。

---

## 8. 非同期テスト

### 8.1 基本

```ts
it('async/await で書く', async () => {
  const user = await fetchUser(1);
  expect(user.name).toBe('Alice');
});
```

`async` 関数で書き、`await` で待つだけ。返り値が Promise なら Vitest が解決を待ってから次のテストへ進む。

### 8.2 `.resolves` / `.rejects` の使い分け

```ts
// fulfilled の値を assert
await expect(fetchUser(1)).resolves.toEqual({ id: 1, name: 'a' });

// rejected を assert
await expect(fetchUser(-1)).rejects.toThrow('not found');
```

- 単に「Promise が解決すればよい」だけなら `await fetchUser(1)` でも OK。
- `.rejects` は「エラーになる」事を主目的に書きたい場面に向く (try/catch を書くより簡潔)。
- どちらの形でも **`await` を必ず付ける**。

### 8.3 `expect.assertions(n)`

非同期テストでは「assert に到達せず通った」事故が起きやすい。`expect.assertions(n)` を入れておくと、最終的に n 回の assert が呼ばれなかった場合に fail する:

```ts
it('rejects する', async () => {
  expect.assertions(1);  // ← 必ず 1 回 assert が走ることを担保
  try {
    await throwingFn();
  } catch (e) {
    expect(e).toBeInstanceOf(MyError);
  }
});
```

`expect.hasAssertions()` は「1 回以上」を保証するゆるい版。

---

## 9. 設定 (`vitest.config.ts`)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ↓ ここに書ける
  },
});
```

主要オプション (本プロジェクトで利用する/しないにかかわらず代表的なものを表で網羅):

### 9.1 対象選定

| キー | 既定値 | 説明 |
|------|--------|------|
| `include` | `['**/*.{test,spec}.?(c\|m)[jt]s?(x)']` | テストファイルとみなす glob |
| `exclude` | `['**/node_modules/**', '**/dist/**', ...]` | 除外 glob |
| `testNamePattern` | — | テスト名 (describe + it) を正規表現で絞る。CLI の `-t` と同じ |

### 9.2 環境

| キー | 既定値 | 説明 |
|------|--------|------|
| `environment` | `'node'` | テストを走らせる環境。`'jsdom'` / `'happy-dom'` / `'edge-runtime'` も選べる |
| `globals` | `false` | `true` にすると `describe / it / expect / vi` を import 不要で使える (Jest 互換) |

本プロジェクトでは `globals: false` のままで、毎ファイル明示 import している (Bundler 視点で何が使われているか追える)。

### 9.3 モック挙動

| キー | 効果 |
|------|------|
| `clearMocks` | 各テスト前に `vi.clearAllMocks()` 相当 (履歴のみクリア) |
| `mockReset` / `resetMocks` | 各テスト前に `vi.resetAllMocks()` (履歴 + 実装) |
| `restoreMocks` | 各テスト前に `vi.restoreAllMocks()` (履歴 + 実装 + スパイ復元) |
| `unstubGlobals` | 各テスト前に `vi.unstubAllGlobals()` |
| `unstubEnvs` | 各テスト前に `vi.unstubAllEnvs()` |

3 つの「リセット系」の違いは [6.10 節](#610-状態リセット--3-種類の使い分け) を参照。

### 9.4 並列性

| キー | 既定値 | 説明 |
|------|--------|------|
| `fileParallelism` | `true` | 複数テストファイルを並列実行するか |
| `pool` | `'threads'` (条件で `'forks'`) | ワーカープール種別。`'threads'` / `'forks'` / `'vmThreads'` / `'vmForks'` |
| `poolOptions` | — | `pool` ごとの細かい設定 (`threads.singleThread`, `forks.singleFork`, `forks.minForks`, `forks.maxForks` 等) |
| `isolate` | `true` | ファイルごとにモジュールキャッシュを分離するか (`false` にすると高速だが副作用に注意) |

本プロジェクトの結合テスト側 (`vitest.integration.config.ts`) は **DB 共有のため直列化** が必要なので
`fileParallelism: false` + `pool: 'forks'` + `poolOptions: { forks: { singleFork: true } }` を使う。

### 9.5 タイムアウト

| キー | 既定値 | 用途 |
|------|--------|------|
| `testTimeout` | `5000` (ms) | 各 `it` の上限 |
| `hookTimeout` | `10000` (ms) | `beforeAll` / `afterAll` 等の上限 |
| `teardownTimeout` | `10000` (ms) | `globalSetup` 戻り値の teardown 関数の上限 |

### 9.6 共有処理

| キー | 用途 |
|------|------|
| `globalSetup` | 全テスト実行の前後に 1 回ずつ走るスクリプト ([4.2 節](#42-globalsetup-と-setupfiles-との使い分け)) |
| `setupFiles` | 各テストファイルの先頭で走るスクリプト (jest-dom 拡張、共通モック等) |
| `globalTeardown` | `globalSetup` とペアの後始末 (戻り値で渡す方式が多い) |

### 9.7 その他

| キー | 用途 |
|------|------|
| `env` | テストプロセスの `process.env` に注入する変数 (dotenv より先に効く) |
| `alias` | パスエイリアス。Vite の `resolve.alias` と同じ書式 |
| `coverage` | カバレッジ設定 (`provider: 'v8' \| 'istanbul'`, `reporter`, `include`, `exclude`, `thresholds` 等) |
| `reporters` | レポーター指定 (`'default'` / `'verbose'` / `'junit'` / `'json'` / `'html'`) |
| `retry` | 失敗時の自動リトライ回数 |
| `bail` | n 件失敗したら以降のテストを中断 |

---

## 10. CLI

### 10.1 サブコマンド

| コマンド | 意味 |
|----------|------|
| `vitest` | watch モードで起動 (`vitest watch` と同じ) |
| `vitest run` | 1 回実行して終了 |
| `vitest watch` | watch モード明示版 |
| `vitest dev` | watch + 開発用デフォルト |
| `vitest related <file>` | 指定ファイルに関連するテストだけ実行 |
| `vitest bench` | ベンチマーク実行 (`bench()` ブロック対象) |
| `vitest --ui` | ブラウザ UI で実行 |

### 10.2 主要フラグ

| フラグ | 効果 |
|--------|------|
| `--config <path>` | 設定ファイルを明示 (本プロジェクトの `npm run test:integration` で使用) |
| `-t <regex>` / `--testNamePattern <regex>` | テスト名フィルタ |
| `--coverage` | カバレッジを取る |
| `--reporter <name>` | レポーター指定 (複数可) |
| `--changed [ref]` | git で変更されたファイルに関連するテストだけ実行 |
| `--retry <n>` | 失敗時にリトライ |
| `--bail <n>` | n 件失敗で中断 |
| `--silent` | 標準出力を抑制 |
| `--update` / `-u` | スナップショットを更新 |
| `--passWithNoTests` | テストが 0 件でも成功扱い |
| `--shard <i>/<n>` | テストを `n` 個に分割し `i` 番目を実行 (CI 並列化) |

---

## 11. 本プロジェクトでの使い方の対応表

公式 API がこのリポジトリの **どこで** 使われているかの目次。実装の細部は [`testing-implementation-guide.md`](./testing-implementation-guide.md) を参照。

| Vitest API | プロジェクト内の使用箇所 |
|------------|--------------------------|
| `describe` / `it` / `expect` | すべてのテストファイル |
| `beforeEach` | `backend/src/services/__tests__/*.test.ts` で `mockResolvedValue` を毎回張り直し / 結合テストの `cleanupDb` |
| `afterAll` | 結合 / E2E テストで `pool.end()` を呼ぶ |
| `vi.mock()` | `backend/src/services/__tests__/mail.service.test.ts` で `../../config/mail`、`qrcode.service.test.ts` で `qrcode` / `storage.service` |
| `vi.mocked()` | 同上。型補完を効かせるため |
| `vi.fn()` | `vi.mock` のファクトリ内で関数差し替えに使用 |
| `vi.stubGlobal` / `vi.unstubAllGlobals` | `frontend/src/lib/__tests__/api.test.ts` で `fetch` を差し替え |
| `mockResolvedValue` / `mockRejectedValue` | `mail.service.test.ts` のエラー伝播ケース等 |
| `toHaveBeenCalledOnce` / `toHaveBeenCalledWith` | 全モック検証で使用 |
| `expect(...).rejects.toThrow(...)` | `mail.service.test.ts` ケース 3 |
| `toMatch` / `toContain` / `toBe` | アサーションの基本 |
| `globalSetup` (config) | `backend/vitest.integration.config.ts` → `backend/src/__tests__/global-setup.ts` |
| `pool: 'forks'` + `singleFork: true` (config) | `vitest.integration.config.ts` (DB 共有のため直列化) |
| `env:` (config) | `vitest.integration.config.ts` でテスト DB / S3 / Auth の接続情報を注入 |
| `clearMocks: true` (config) | 両 `vitest.config.ts` / `vitest.integration.config.ts` |

未使用の API (`vi.useFakeTimers`, `vi.spyOn`, `vi.hoisted`, `it.each`, スナップショット系等) は本ドキュメント上記の各節を参照。

---

## 12. 用語解説

このドキュメントで前提として使っている用語のうち、本プロジェクトの理解に重要なものを補足する。

### 12.1 トランスパイラ (transpiler)

**「あるバージョン / 言語のソースコードを、別バージョン / 言語のソースコードへ変換するツール」** のこと。`translator + compiler` の合成語。出力も**ソースコード** (機械語ではない) という点で、伝統的な「コンパイラ」とは区別される。

代表的な変換例:

| 変換元 | 変換先 | 用途 |
|--------|--------|------|
| TypeScript | JavaScript | 型を剥がしてランタイムで実行可能にする |
| ES2024 の新構文 | ES5 の古い構文 | 古いブラウザでも動かす |
| JSX | 関数呼び出し (`React.createElement(...)`) | ブラウザは JSX を直接読めないため |
| ESM (`import/export`) | CommonJS (`require/module.exports`) | Node の旧モジュール形式に合わせる |

代表的な実装:

| 実装 | 速度 | 主な採用先 |
|------|------|------------|
| `tsc` | 遅い (型チェック付き) | TypeScript 公式コンパイラ |
| `Babel` | 中 | Jest や旧来の React プロジェクト |
| `esbuild` | 非常に速い (Go 製) | **Vite / Vitest** が採用 |
| `swc` | 非常に速い (Rust 製) | Next.js などが採用 |

**本プロジェクトで重要なのは esbuild**:
- フロントエンドの Vite と Vitest が同じ esbuild を共有しているため、`vite.config.ts` の `resolve.alias` や `plugins` の設定がテストにもそのまま効く。
- バックエンドの `build` / `build:lambda` スクリプトも esbuild を使う (`backend/package.json` 参照)。`tsx watch src/index.ts` の `tsx` も内部は esbuild。
- TypeScript 用に別途 `ts-jest` のような変換層を入れなくて済むのが、Jest に対する Vitest の大きな利点 ([1 章](#1-vitest-とは) の比較表参照)。

**コンパイラとの違い**: 「コンパイラは高レベル言語 → 機械語 (異なる抽象レベルへの変換)」「トランスパイラは高レベル言語 → 高レベル言語 (同じ抽象レベル内の変換)」とよく説明される。厳密な境界はないが、JS / TS まわりのソース変換ツールは慣習的に「トランスパイラ」と呼ばれる。

### 12.2 ホイスト (hoist / hoisting)

英語で「巻き上げる / 持ち上げる」。プログラミングでは **「コードの実行時に、ある宣言や呼び出しが、書かれた場所より前のほうへ "持ち上げられる" 挙動」** を指す。

JavaScript の文脈では 2 種類のホイストがあり、混同しやすいので区別が大事。

#### (1) JavaScript エンジンが自動でやるホイスト — 言語仕様

`var` 宣言と `function` 宣言は、書いた位置に関係なくスコープの先頭で「宣言された扱い」になる:

```js
console.log(foo());  // "hi" ← 後で定義しているのに呼べる
console.log(x);      // undefined ← エラーにならない (宣言だけ持ち上がる)

function foo() { return 'hi'; }
var x = 10;
```

これは JS エンジンが「宣言部分だけを先に読む」ためで、`let` / `const` には起こらない (TDZ: Temporal Dead Zone)。

#### (2) ツールが意図的にやるホイスト — Vitest の `vi.mock` がこれ

Vitest のトランスフォーマー ([12.1](#121-トランスパイラ-transpiler) 参照) は、テストファイルをパースして `vi.mock(...)` の行を**物理的にファイル先頭へ移動**してから実行する。

```ts
// 書いたコード
import { sendEmail } from '../config/mail';
vi.mock('../config/mail', () => ({ sendEmail: vi.fn() }));
```

```ts
// 実際に走るコード (ホイスト後)
vi.mock('../config/mail', () => ({ sendEmail: vi.fn() }));
import { sendEmail } from '../config/mail';
```

**なぜホイストが必要か**: ES Modules では `import` 文がファイル中で最初に評価される仕様。何もしないと「`import` で本物が読まれた**後**に `vi.mock` が走る」ことになりモックが効かない。Vitest はこの順序を強制的にひっくり返すために `vi.mock` を巻き上げる。

```
ホイストなし:  import (本物が読まれる)  → vi.mock (もう遅い)
ホイストあり:  vi.mock (差し替え設定)   → import (差し替え版が読まれる) ✓
```

**ホイストの副作用 (ハマりやすいポイント)**:

`vi.mock` のファクトリ関数からファイル冒頭の `const` などを参照すると、ホイスト先で未定義になって壊れる:

```ts
const fakeSend = vi.fn();           // ← (1)
vi.mock('../config/mail', () => ({
  sendEmail: fakeSend,              // ← (2) ホイストされるとここは (1) より先に評価される
}));
```

→ 回避策は [6.8 節](#68-巻き上げが必要な変数-vihoisted) の `vi.hoisted()`。
→ そもそもホイストを止めたいときは [6.5 節](#65-vidomock-ホイストしない版) の `vi.doMock()` を使う。

### 12.3 factory (ファクトリ関数)

**「呼び出すと何かを作って返す関数」** のこと。プログラミング全般で広く使われる用語で、「工場 (factory) のように、必要なときにモノを作って返してくれる関数」という比喩から来ている。**「Factory パターン」** というデザインパターン名でも有名。

Vitest の文脈では特に、`vi.mock(modulePath, factory?)` / `vi.doMock(modulePath, factory?)` / `vi.hoisted(factory)` などの **引数に渡すコールバック関数** を指す:

```ts
vi.mock('../config/mail', () => ({   // ← この () => ({ ... }) 全体が factory
  sendEmail: vi.fn(),
  MAIL_TIMEOUT: 3000,
}));
//                ↑
// Vitest 側がこの関数を「適切なタイミングで」呼び出して、
// 戻り値のオブジェクトをモジュールの新しい exports として使う
```

`vi.mock` の factory のシグネチャは概念的にはこう:

```ts
type Factory = () => Record<string, unknown> | Promise<Record<string, unknown>>;
//             ↑                ↑
//          引数なし    そのモジュールの exports として使われるオブジェクト
```

**ただの値 (オブジェクト) ではなく関数なのはなぜ?**

1. **評価タイミングを遅らせるため** — factory はモジュールが実際に import される瞬間に Vitest が呼び出す。例えば `vi.fn()` の生成や `vi.importActual()` の呼び出しを **テスト実行コンテキスト内** で行いたい場合、関数でラップする必要がある。
2. **async にできる** — `async () => { const actual = await vi.importActual(...); return { ...actual, x: vi.fn() }; }` のように本物の exports を取り込んでから一部だけ差し替えるパターンが書ける ([6.4 節](#64-部分モック-viimportactual))。
3. **毎回計算するロジックを挟める** — factory 内で乱数や日付など動的な値を組み立てることも可能。

**本ドキュメント内で factory が登場する場所**:

- [`vi.mock` の factory](#63-モジュールモック-vimock) — モジュールの exports を作る (`() => ({ ... })`)
- [`vi.doMock` の factory](#65-vidomock-ホイストしない版) — 同上だがホイストされない
- [`vi.hoisted` の factory](#68-巻き上げが必要な変数-vihoisted) — ホイストして 1 回だけ実行する初期化処理

なお Vitest 以外の文脈でも "factory function" / "factory pattern" / "○○Factory" という名前付けは頻出します。「**何かを組み立てて返してくれる関数 / オブジェクト**」と覚えておけば、初見でも意味が取れます。

---

## 13. 関連ドキュメント

- [`testing-implementation-guide.md`](./testing-implementation-guide.md) — 本プロジェクトの **テスト実装記録** (どこに何を置いてどう書いたか)
- [`backend-testing-strategy.md`](../backend-testing-strategy.md) — テスト粒度の戦略 (Unit / Integration / E2E の使い分け)
- 公式ドキュメント: <https://vitest.dev/>
- Vitest API リファレンス: <https://vitest.dev/api/>
- Vitest 設定リファレンス: <https://vitest.dev/config/>
