# jsdom と `window.location` のモック — なぜ `Object.defineProperty` を使うのか

`frontend/src/lib/__tests__/api.test.ts` を読むと、テストの冒頭でいきなりこんなコードが出てきます:

```ts
const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname: '/', href: '/' },
  });
  vi.stubGlobal('fetch', vi.fn());
});
```

「なぜ `window.location = {...}` と直接代入しないのか?」「`Object.defineProperty` が何をしているのか?」「`originalLocation` は何のために退避しているのか?」 — これらに答えるのが本ドキュメントの目的です。

このドキュメントは **「なぜそう書くか」 (Mental Model)** を扱います。「どう書くか」 (コード例) は [`testing-implementation-guide.md`](./testing-implementation-guide.md) §5.5、規約レベルのチートシートは [`frontend-testing-strategy.md`](./frontend-testing-strategy.md) §6、Vitest API の詳細は [`vitest-reference.md`](./vitest-reference.md) を参照してください。jsdom / happy-dom / node の選び方は [`vitest-config-front-vs-back.md`](./vitest-config-front-vs-back.md) §3.2 にあります。

---

## 1. そもそも jsdom とは何か

jsdom は **Node.js 上で動く「ブラウザもどき」のシミュレータ** です。本物のブラウザは一切起動しません。`window` / `document` / `window.location` / `localStorage` などのオブジェクトは、すべて jsdom が JavaScript で実装したエミュレーションです。

| 観点 | 実ブラウザ (Chrome 等) | jsdom |
|---|---|---|
| 実装言語 | C++/Rust 中心 + JS エンジン | 純粋な JavaScript |
| 描画 | あり (ピクセル) | なし (DOM ツリーだけ持つ) |
| ナビゲーション | URL バーやリンクで実際に遷移 | 遷移したフリだけ (バージョンによる) |
| 並列実行 | 重い | 軽い (Node のプロセス内に作れる) |

「実ブラウザより速く、`document.querySelector` などの DOM API は使える、ただし描画やレイアウト計算は当てにできない」 — これが jsdom の立ち位置です。フロントのユニット〜コンポーネントテストには十分で、Vitest のフロントエンド設定 (`environment: 'jsdom'`) で取り込まれています ([`vitest-config-front-vs-back.md`](./vitest-config-front-vs-back.md) §3.2)。

---

## 2. 本物のブラウザでも `window.location` は自由に書き換えられない

「実ブラウザの `window.location` なら普通に代入できて、jsdom だけ厳しい」 — これは **誤解** です。実ブラウザでも `window.location` は仕様レベルでかなり特殊な扱いを受けています。

### 2.1 Location オブジェクト自体は再代入できない

```js
window.location = { pathname: '/foo' };
// → Chrome: TypeError: Assignment to read-only properties is not allowed ...
//   (実装によっては「URL 文字列として解釈して遷移する」レガシー挙動)
```

`window.location` プロパティはブラウザ側で書き換えが封じられていて、別のオブジェクトに丸ごと差し替えることはそもそも仕様外です。

### 2.2 `href` / `pathname` は「保存できる値」ではなく「遷移を起こす setter」

```js
window.location.href = '/login';
```

これは一見「文字列を代入しただけ」に見えますが、実際は **setter が走って "そのURLへ画面遷移しろ" という指示** になります。`window.location.pathname = '/foo'` も同様で、書いた瞬間に遷移トリガが引かれます。値を保存しているわけではありません。

### 2.3 まとめ

本物のブラウザでも:

- `window.location` を別オブジェクトに置き換えるのは原則不可
- `href` / `pathname` への代入は値の保存ではなく **副作用 (遷移) を起こす操作**

つまり「テストで値を保存してあとで `expect` で読みたい」用途には、本物の `window.location` はそもそも合っていません。

---

## 3. jsdom はその「書き換えにくさ」まで真似ている

jsdom は仕様準拠を重視して作られているので、上で見たブラウザの "書き換えにくさ" まで再現しています。

具体的には `window.location` プロパティは `writable: false` 寄りに設定されていて、

```js
window.location = { pathname: '/' };
// → jsdom: TypeError: Cannot assign to read only property 'location' of object '[object Window]'
//   (バージョンによってはサイレントに無視されることもあり)

window.location.href = '/login';
// → jsdom: 値が保存される場合もあれば、ナビゲーション扱いで例外を投げる場合もある
```

テストでは「画面遷移」も「例外」も要らず、ただ「`href` に文字列が入った事実だけ」を後から `expect` で確認したいだけです。だから jsdom の素のままでは扱いづらく、**一旦この制約を剥がす必要** があります。

---

## 4. プロパティ記述子 (Property Descriptor) のおさらい

`Object.defineProperty` を理解する前に、JavaScript のプロパティが持つメタ情報を整理します。各プロパティには 4 つの記述子 (descriptor) が付いています:

| 記述子 | 意味 | `false` だとどうなるか |
|---|---|---|
| `value` | プロパティの値 | — |
| `writable` | 代入できるか | `=` での代入が黙って無視 or TypeError |
| `enumerable` | `for...in` / `Object.keys` で列挙されるか | 列挙されない |
| `configurable` | `delete` や `defineProperty` で **再定義** できるか | 再定義不可 |

jsdom の `window.location` はおおむね `writable: false` 寄りに設定されているため、`window.location = {...}` の素朴な代入は通りません。ただし `configurable` まで完全に閉じてはいないため、`Object.defineProperty` 経由でなら **記述子ごと丸ごと再定義** できる、というのが今回のテクニックの核です。

---

## 5. `Object.defineProperty(window, 'location', { ... })` が何をしているか

api.test.ts:86-90 を再掲します:

```ts
Object.defineProperty(window, 'location', {
  configurable: true,
  writable: true,
  value: { pathname: '/', href: '/' },
});
```

これは **「`window.location` というプロパティを、記述子ごと別オブジェクトに置き換える」** 操作です。具体的に各フィールドが何のためにあるかを分解します:

- `value: { pathname: '/', href: '/' }`
  - 新しい `window.location` の中身。Location 風の最小モック
  - `pathname` と `href` の 2 つだけしか持たないのは、テスト対象の `api.ts` がこの 2 つしか読まないため (api.ts:91 / 93)
  - jsdom が用意していた本物の Location インスタンスではなく、ただの POJO (plain object)
- `writable: true`
  - 「以降 `window.location.href = '/login'` のような代入を許す」
  - POJO + writable: true の組み合わせなので、setter が走らず "ただ値が格納されるだけ"。これがテストで欲しい挙動
- `configurable: true`
  - 「もう一度 `defineProperty` で再定義することを許す」
  - `afterEach` で元に戻すときに必須。これが `false` だと「書き換えた後はもう戻せない」状態になり、他テストファイルを破壊する

結果として、`Object.defineProperty` の 1 行を通った後の `window.location` は、本物の Location オブジェクトの「再代入不可・setter 動作」という性質を失った、ただの平易なオブジェクトになります。テストはここで初めて `window.location.href` を素直に書いたり読んだりできるようになります。

---

## 6. `originalLocation` で退避するパターン

api.test.ts の冒頭にこんな 1 行があります:

```ts
const originalLocation = window.location;
```

これは **「URL 文字列を保存している」のではなく「Location オブジェクトの参照 (jsdom が用意したインスタンス自身) を保存している」** 点に注意してください。

なぜ退避するか:

1. `beforeEach` で `Object.defineProperty(window, 'location', { value: { pathname, href } })` を呼ぶと、`window.location` は POJO に置き換わってしまう
2. テストが終わったあと、他のテストファイル (例: `frontend/src/components/__tests__/QrCodeGenerator.test.tsx`) は `window.location` が **本物の Location インスタンス** であることを暗黙に期待している
3. `afterEach` で `originalLocation` を再度 `defineProperty` で書き戻すことで、テスト同士の干渉を防ぐ

```ts
afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
});
```

これはテスト独立性 (Test Isolation) を担保する常套手段で、グローバルを差し替えるテクニック全般に共通する作法です。

---

## 7. まとめ: なぜテストでこれが必要か

ひとことで言うと:

- **本物のブラウザでも jsdom でも `window.location` は素直に書き換えられない**
  - Location 自体は再代入不可
  - `href` / `pathname` は setter で遷移を起こす副作用つき
- **テストが欲しいのは「値の保存」だけ** (画面遷移したいわけでも、例外を投げたいわけでもない)
- **そこで `Object.defineProperty` で記述子ごと差し替えて、ただの POJO + writable: true に置き換える** → 以降の代入は素直に値が入るだけ
- **後始末** は `afterEach` で `originalLocation` を書き戻す

実装側 (`api.ts`) は本番のブラウザで動くときと同じコードのまま、テストでは「値が入ったか」だけ検証できる、という分業が成立します。

---

## 8. 関連: `vi.stubGlobal('fetch', vi.fn())` も発想は同じ

api.test.ts の `beforeEach` でもう一つ呼ばれている `vi.stubGlobal('fetch', vi.fn())` も、思想としては同じ「グローバルを一時的に差し替える」操作です。違いは:

| 対象 | 差し替え方 | 理由 |
|---|---|---|
| `globalThis.fetch` | `vi.stubGlobal('fetch', vi.fn())` + `vi.unstubAllGlobals()` | Vitest が一括管理してくれる。`unstubAllGlobals` で自動復元 |
| `window.location` | `Object.defineProperty` を手書き | プロパティ記述子レベルで `writable: false` 寄りに保護されているため、`stubGlobal` だけでは効かないケースがある |

`vi.stubGlobal` も内部的には `defineProperty` を使いますが、相手側プロパティが `configurable: false` だと差し替えに失敗します。`window.location` だけ別ルートで `Object.defineProperty` を直接叩いているのはそのためです。

`vi.stubGlobal` の API 詳細は [`vitest-reference.md`](./vitest-reference.md) (vi.stubGlobal の節) を参照してください。
