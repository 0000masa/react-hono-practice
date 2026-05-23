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
  - jsdom が用意していた本物の Location インスタンスではなく、ただの **素のオブジェクト** (= 特別な prototype や setter を持たない、`{ key: value }` だけの塊。英語圏では POJO (Plain Old JavaScript Object) とも呼ばれる)
- `writable: true`
  - 「以降 `window.location.href = '/login'` のような代入を許す」
  - 素のオブジェクト + `writable: true` の組み合わせなので、setter が走らず "ただ値が格納されるだけ"。これがテストで欲しい挙動
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

1. `beforeEach` で `Object.defineProperty(window, 'location', { value: { pathname, href } })` を呼ぶと、`window.location` は素のオブジェクトに置き換わってしまう
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
- **そこで `Object.defineProperty` で記述子ごと差し替えて、ただの素のオブジェクト + `writable: true` に置き換える** → 以降の代入は素直に値が入るだけ
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

---

## 9. FAQ: そのまま `window.location.href = '/login'` をテスト内で代入すればいいのでは?

「`Object.defineProperty` を使わなくても、テスト内で `window.location.href = '/login'` と書けば同じ挙動になるのでは?」というのは、最初に必ず出てくる疑問です。結論から言うと **動きません**。具体的にどこで詰むかを api.test.ts のテスト 4 ([§5](#5-objectdefinepropertywindow-location---が何をしているか) で解説したケース) を例に追っていきます。

テストの流れはこうなっています:

```ts
// (A) 「いま /dashboard にいる」という前提状態をセット
(window.location as ...).pathname = '/dashboard';

// (B) api.ts を呼ぶと、内部で window.location.href = '/login' が走る
await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);

// (C) 「/login へのリダイレクトが指示された」ことを観測
expect(window.location.href).toBe('/login');
```

ここで重要なのは: **テスト側は実際に画面遷移したいわけではない**、ということです。やりたいのは「`api.ts` が `href = '/login'` という代入を **試みたか?**」の観測だけ。

### 9.1 (A) で詰む — `pathname = '/dashboard'` の時点で例外

本物の `window.location.pathname` は setter で、書いた瞬間に「`/dashboard` へ遷移しろ」というナビゲーションを起こします。jsdom はこの遷移処理を実装していないため、

```js
window.location.pathname = '/dashboard';
// → jsdom: Error: Not implemented: navigation (except hash changes)
```

がよく投げられます (jsdom の README にも明記されている既知の制約)。バージョンによってはサイレントに無視されることもあり、挙動が安定しません。
**「テスト前提として今のページを `/dashboard` にする」というセットアップそのものができない** わけです。

### 9.2 (B) で詰む — `api.ts` 内の `href = '/login'` も同じ setter

仮に (A) を諦めても、(B) で `api.ts` が走らせる `window.location.href = '/login'` も同じ setter 経由なので、

```
Error: Not implemented: navigation (except hash changes)
```

がここで投げられます。本来テストしたいのは 401 ハンドリングなのに、**jsdom のナビゲーション例外が先に出てしまい、api.ts 側のエラーがすり替わる** という事故になります。

### 9.3 (C) でも壊れる — 値が「保存」されない

仮に jsdom が例外を投げない実装だったとしても、本物の Location は `href` への代入を「**値の保存**」ではなく「**遷移指示**」として解釈します。遷移が起きると `window.location` 全体が新しい URL の状態に再初期化されてしまうため、後から `expect(window.location.href).toBe('/login')` で読んだ値がこちらの期待通りに残っている保証はありません (オリジン補完、末尾スラッシュの正規化など URL パーサ経由の変形も入る)。

### 9.4 素のオブジェクトに差し替えると全部解決する

[§5](#5-objectdefinepropertywindow-location---が何をしているか) のとおり `Object.defineProperty` で **ただの素のオブジェクトに置き換える** と、

- `(window.location as ...).pathname = '/dashboard'` → ただのプロパティ代入。例外も遷移も起きない、値が入るだけ
- `api.ts` 側の `window.location.href = '/login'` → これもただのプロパティ代入。値が入るだけ
- `expect(window.location.href).toBe('/login')` → 上で入った値をそのまま読むだけ

setter のロジックが丸ごと取り除かれているので、`api.ts` 側は「ブラウザに対して遷移を指示した気でいる」だけで、実際は素のオブジェクトのフィールドに文字列が代入されている、という構造になります。これで「ブラウザ動作に踏み込まず、API クライアントの**意図**だけを観測する」という単体テストが成立します。

### 9.5 比較表

| やりたいこと | 本物 `window.location` (jsdom そのまま) | 素のオブジェクトに差し替え (`Object.defineProperty`) |
|---|---|---|
| `pathname = '/dashboard'` で前提状態を作る | `Not implemented: navigation` 例外 or 不安定 | ただの代入 OK |
| `api.ts` が `href = '/login'` を試みる | 同じく navigation 例外で本来のエラーがかき消える | ただの代入 OK |
| `href` を後から `expect` で読む | 遷移処理を経た正規化後の値 (不安定) | 入れた値がそのまま読める |

### 9.6 ひとことで

- jsdom には本物の遷移処理が無い → setter は例外 or 無視
- 本物のブラウザでは setter は副作用が広すぎる → テスト観測点を壊す

の二重苦になるため、「**遷移のフリすら起こさせず、ただの代入で値を残すだけのオブジェクト**」に置き換える `Object.defineProperty` パターンが結局いちばん素直、というのが結論です。

---

## 10. 補足: 「jsdom に遷移処理が無いから」は半分の理由 / `Object.defineProperty` は何の機能か

ここまでで「`window.location` を素のオブジェクトに差し替える理由」と「具体的な詰みどころ」 ([§9](#9-faq-そのまま-windowlocationhref--login-をテスト内で代入すればいいのでは)) は説明しましたが、よく聞かれる 2 つの疑問にもう一段答えておきます。

### 10.1 「jsdom に遷移処理が無いから差し替える」だけが理由ではない

「結局 jsdom に遷移処理が無いから素のオブジェクトに差し替えるんでしょ?」 — この理解は **方向としては正しい** のですが、実は **2 段重ねの理由** があります。

| レイヤ | 何が困るか | 結論 |
|---|---|---|
| 表面 (jsdom 固有) | jsdom には遷移処理の実装が無く、`pathname = ...` や `href = ...` で `Not implemented: navigation` 例外が出る/挙動が不安定 | テストが setter にぶつかるだけで落ちる |
| 根本 (テスト一般) | 仮に遷移が動いても、テストでは副作用を起こさず「代入の意図」だけ観測したい (遷移すると `window.location` 全体や DOM・React 状態が再初期化されてしまう) | 本物のブラウザでも素のオブジェクトに差し替えたい |

つまり:

- **「jsdom に遷移処理が無いから差し替える」と覚えても実用上はまず正解**
- ただし「本物のブラウザだったとしても、テスト中に遷移されては困る」という背景まで押さえると、ワークアラウンドではなく **正攻法** として `Object.defineProperty` パターンが選ばれていることが腑に落ちる

別の見方をすると、jsdom はあえて遷移処理を実装していない (= 例外を投げる) ことで、**「テストの中で遷移を起こさないでね」というメッセージ** を発しているとも言えます。テスト中に遷移が走ったら困るのはどの環境でも同じなので、jsdom の振る舞いは合理的です。

### 10.2 `Object.defineProperty` は TypeScript の機能ではなく JavaScript 標準

`Object.defineProperty` を見て「TypeScript の何か特別な機能?」と感じるかもしれませんが、**これは JavaScript (ECMAScript) 標準のメソッド** です。

- **ES5 (2009 年) で導入** されたグローバル `Object` のメソッド
- ブラウザ / Node.js / Deno / Bun ── どの JS ランタイムでも素の JavaScript として使える
- TypeScript は JavaScript のスーパーセットなので、そのまま使える + `lib.es5.d.ts` 由来の型定義で型補完が効くだけ

同系列の `Object` 標準メソッドをまとめておくと、この界隈に馴染みが出やすくなります:

| メソッド | 役割 |
|---|---|
| `Object.defineProperty(obj, key, descriptor)` | プロパティ記述子を指定して定義/再定義 |
| `Object.getOwnPropertyDescriptor(obj, key)` | プロパティ記述子を取り出す (デバッグ・調査用) |
| `Object.keys(obj)` / `Object.values(obj)` / `Object.entries(obj)` | プロパティの列挙系 |
| `Object.freeze(obj)` | 全プロパティを `writable: false` + `configurable: false` にして "凍結" する |
| `Object.assign(target, ...sources)` | 浅いコピー (シャローコピー) |

「TypeScript 固有だから難しそう」と感じる必要はなく、Node.js のスクリプトでも、ブラウザの DevTools コンソールでも、同じように動きます。実際 [§5](#5-objectdefinepropertywindow-location---が何をしているか) のコードは `.ts` ですが、`.js` で書いても 1 文字も変えずに動作します (TypeScript は型注釈を追加できるだけで、ランタイム挙動は JavaScript そのものだから)。
