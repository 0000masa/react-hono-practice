# `vitest.config.ts` のフロントエンド / バックエンド差分

`backend/vitest.config.ts` と `frontend/vitest.config.ts` を見比べると、`defineConfig({ test: { ... } })` という骨格は同じなのに中身が微妙に違うことに気付きます。

このドキュメントは:

- 「なぜ違うのか」 — フロントエンドとバックエンドで本質的に必要なものが違うから
- 「どこが違うのか」 — 1 行ずつ突き合わせて理由を解説
- 「これはどこでも起こることか」 — Vitest を使う他のプロジェクトでも基本的に同じ分岐が出る

を整理したものです。Vitest 自体の API 解説は [`vitest-reference.md`](./vitest-reference.md)、本プロジェクトでどう書いたかは [`testing-implementation-guide.md`](./testing-implementation-guide.md) を参照してください。

---

## 1. 全文を並べて見る

### `backend/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/**/__tests__/integration/**',
      'src/**/__tests__/e2e/**',
      'src/**/*.integration.test.ts',
      'src/**/*.e2e.test.ts',
    ],
    environment: 'node',
    clearMocks: true,
  },
});
```

### `frontend/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
```

---

## 2. 差分早見表

| 設定 | backend | frontend | 違う本質的な理由 |
|------|---------|----------|------------------|
| `plugins` | (なし) | `[react()]` | JSX/TSX を読むには Vite プラグインで変換が必要 |
| `environment` | `'node'` | `'jsdom'` | DOM API (`document`, `window`) を使うかどうか |
| `globals` | (false, デフォルト) | `true` | testing-library と Jest 流儀に揃えるか、明示 import を貫くか |
| `setupFiles` | (なし) | `['./src/test/setup.ts']` | jest-dom マッチャの拡張 / `afterEach(cleanup)` が要るかどうか |
| `css` | (デフォルト = 解決を試みる) | `false` | コンポーネントが import する CSS をテストで読む必要がない |
| `include` | 明示指定 | (デフォルト) | バックエンドは Unit / Integration / E2E を **同じ拡張子で並走** させるため絞り込みが必要 |
| `exclude` | Integration / E2E を除外 | (デフォルト) | 上に同じ。フロントエンドは Integration / E2E を持たないので不要 |
| `clearMocks` | `true` | (なし) | フロントは `setupFiles` 側で `afterEach(cleanup)` をやっているため Vitest の自動クリアより DOM クリーンアップが主役 |
| コードスタイル | セミコロンあり | セミコロンなし | プロジェクトごとの lint / フォーマッタの違い (テスト固有ではなく、各サブパッケージの規約) |

「フロントエンドとバックエンドで変わるものなのか?」への端的な答え:

> **はい。本質的に必要なものが違うため、Vitest を使う他のプロジェクトでも同じ分岐が必ず出ます。**
> 「フロント = jsdom + plugin-react + setupFiles」「バックエンド = node + 何もなし」が典型的な二項対立で、差分のほとんどはこの 2 つの環境の違いから派生したものです。

---

## 3. 1 行ずつ突き合わせる

### 3.1 `plugins: [react()]` — フロントだけにある

```ts
// frontend
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ...
})
```

`@vitejs/plugin-react` は **JSX/TSX を JavaScript に変換する** Vite プラグインです。React コンポーネントには `<Button onClick={...}>` のような JSX が含まれていて、ブラウザも esbuild もそのままでは読めないため、`React.createElement(...)` 相当に書き換える必要があります。

- Vitest は **テスト実行時に Vite と同じ仕組みでファイルを変換する** ので、`vite.config.ts` 側に書いたプラグインをそのまま `vitest.config.ts` にも書く形になります (本プロジェクトでは `vite.config.ts` の `proxy` 設定とテストの責務を分けるため別ファイルにしていますが、設定の中身としては `plugins: [react()]` で揃っています)。
- バックエンドは TypeScript だけで JSX を一切含まないので、プラグインは要りません。Vitest 標準の esbuild が `.ts` をそのまま JS に変換します ([`vitest-reference.md` 12.1 トランスパイラ](./vitest-reference.md#121-トランスパイラ-transpiler) 参照)。

「React を書いているプロジェクト = `@vitejs/plugin-react` が要る」「サーバ側 TS だけ = 要らない」と覚えて差し支えありません。Vue を使う場合は `@vitejs/plugin-vue`、Svelte なら `@sveltejs/vite-plugin-svelte` と、同じ位置に該当プラグインが入ります。

### 3.2 `environment: 'node'` vs `'jsdom'` — テスト実行環境そのもの

これが一番大きく、他の差分を派生させている根本原因です。

| 値 | 意味 | 何が使える / 使えない |
|----|------|----------------------|
| `'node'` | テストを **生の Node.js プロセス** の中で実行 | `process`, `fs`, `http` … サーバ系 API は全部使える。`document` / `window` / `localStorage` は **存在しない** |
| `'jsdom'` | Node 内に DOM の **JavaScript 実装** をロードして実行 | `document.querySelector(...)`, `window.location`, `localStorage` などが使える。実ブラウザではなく "JavaScript 製のブラウザの真似" |

[`vitest-reference.md` 9.2 環境](./vitest-reference.md#92-環境) にも書いてある通り、Vitest はファイルごとに環境を切り替えられますが、本プロジェクトはプロジェクト単位で固定しています。

なぜフロントが `'jsdom'` を選んでいるか:

```tsx
// frontend/src/components/__tests__/QrCodeGenerator.test.tsx (抜粋)
render(<QrCodeGenerator />)
const button = screen.getByRole('button', { name: '生成' })
await user.click(button)
```

`render(...)` は内部で **DOM ノードを作って** `document.body` に挿入し、`screen.getByRole(...)` は **`document` を走査** して要素を探します。`environment: 'node'` のままだと `document` が `undefined` で `ReferenceError` になります。

逆にバックエンドのテストは:

```ts
// backend/src/services/__tests__/mail.service.test.ts (抜粋)
await sendVerificationMail({ to: 'a@b.c' });
expect(mockedSendEmail).toHaveBeenCalledWith(...);
```

ここに DOM は出てきません。`jsdom` を有効にしてもエラーにはなりませんが、**ロード時間と各テストの起動コストが増えるだけ** で利点ゼロなので `'node'` にしています。

> `'happy-dom'` という jsdom の高速版もあります。本プロジェクトは互換性重視で jsdom を選択しています ([`vitest-reference.md` 9.2](./vitest-reference.md#92-環境))。

### 3.3 `globals: true` — `import { describe } from 'vitest'` を省くかどうか

`globals: false` (デフォルト) のとき、テストファイルでは毎回:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

を書きます。`globals: true` にするとこの import が不要になり、`describe / it / expect / vi` がグローバルに使えるようになります (Jest が昔からこうだったので、Jest 経験者向けの互換オプション)。

| 立場 | 採用しているか | 理由 |
|------|---------------|------|
| backend | `false` (デフォルトのまま) | バンドラ視点で「このファイルが何を使っているか」を import から追える方が読みやすい |
| frontend | `true` | testing-library のコミュニティ流儀に合わせる。`afterEach(cleanup)` を `setupFiles` で書くために `afterEach` をグローバルに置きたい事情もある |

どちらでも書けます。プロジェクトごとに統一されていれば問題ありません。

> なお `globals: true` を入れても TypeScript が型を認識するためには `tsconfig.json` の `types` に `"vitest/globals"` を加える必要があります。本プロジェクトの `frontend/tsconfig.app.json` で対応済み。

### 3.4 `setupFiles: ['./src/test/setup.ts']` — 各テストファイルの前処理

`setupFiles` は **各テストファイルの先頭で毎回走るスクリプト** です ([`vitest-reference.md` 4.2 globalSetup と setupFiles](./vitest-reference.md#42-globalsetup-と-setupfiles-との使い分け))。本プロジェクトのフロントは:

```ts
// frontend/src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

を読ませています。役割は 2 つ:

1. **`@testing-library/jest-dom/vitest`** — `expect(element).toBeInTheDocument()` / `.toHaveValue('...')` のような **DOM 専用マッチャを `expect` に追加** します。`toBeInTheDocument` などは Vitest 標準には無いマッチャで、`@testing-library/jest-dom` パッケージ由来。
2. **`afterEach(cleanup)`** — `@testing-library/react` の `render(...)` で `document.body` に挿入したノードを **テストごとに消す**。これが無いとテスト間で DOM が累積し、`getByRole('button')` が複数見つかってエラーになります。

どちらも **DOM ベースのテストで初めて意味を持つ** ので、Node 環境で動くバックエンドには不要です。バックエンドはサービス層のモックを毎回張り直すスタイルで、グローバルな前処理が要らないため `setupFiles` を持っていません。

### 3.5 `css: false` — コンポーネントが import する CSS を読まない

```tsx
// frontend のコンポーネントにこういう import が出ることがある
import './QrCodeGenerator.css';
import styles from './styles.module.css';
```

通常 Vite は CSS を解析してスタイルシートを組み立てますが、**テストではスタイルが当たっているかは検証しない** (jsdom には実際のレンダリングエンジンが入っていないので、`getComputedStyle` 等はそもそも信頼できない) ため、CSS を読み飛ばして高速化します。`css: false` は「CSS の import を無視する」という指示です。

バックエンドはそもそも CSS を import しないので、このオプションを書く必要すらありません。

### 3.6 `include` / `exclude` — テスト対象のスコープ

バックエンドだけ明示しているのは、**同じプロジェクト内に 3 種類のテストが混在している** ためです:

| 種別 | ファイル名 / ディレクトリ |
|------|--------------------------|
| Unit | `src/services/__tests__/*.test.ts` |
| Integration | `src/__tests__/integration/**/*.test.ts` |
| E2E | `src/__tests__/e2e/**/*.test.ts` |

`npm test` (= `vitest run`) は **実 DB を必要としない Unit だけを走らせたい**。デフォルトの include/exclude のままだと Integration / E2E まで拾ってしまい、テスト用 MySQL が立ち上がっていない環境で全滅します。なので:

- `include`: `src/**/*.test.ts` だけを拾う
- `exclude`: Integration / E2E のディレクトリと、`*.integration.test.ts` / `*.e2e.test.ts` という命名のファイルを除外

としています。Integration / E2E は `vitest.integration.config.ts` 側で逆向きに拾います ([`testing-implementation-guide.md` 1 章 〜 4 章](./testing-implementation-guide.md))。

フロントエンドはこの三層分割をしていない (Unit / Component テストしか無い) ので、デフォルトの `**/*.{test,spec}.?(c|m)[jt]s?(x)` で十分。明示する必要がありません。

> もしフロントエンドに Playwright で書くような本物のブラウザ E2E を加えるなら、Playwright は別ランナーになるので Vitest の include/exclude を触る必要は無いままです。フロントの "Vitest が対象とする層" は Unit / Component に留まる、というプロジェクト構成上の判断が見えます。

### 3.7 `clearMocks: true` — モック履歴の自動クリア

`clearMocks: true` は各テスト前に `vi.clearAllMocks()` を自動実行する設定で、モックの **呼び出し履歴 (`mock.calls`) だけ** を消します。実装 (`mockReturnValue` で仕込んだ戻り値) は残ります ([`vitest-reference.md` 6.10 状態リセット](./vitest-reference.md#610-状態リセット--3-種類の使い分け))。

- backend では `vi.mock(...)` でモジュール丸ごとモック化して使うため、テスト間で履歴が漏れないよう保険として `clearMocks: true` を入れています。実装は `beforeEach` で毎回張り直すスタイル。
- frontend では `vi.stubGlobal('fetch', vi.fn())` を使うところで `vi.unstubAllGlobals()` を呼ぶなど、ファイル側で個別に管理しているので config レベルでは入れていません。代わりに `setupFiles` の `afterEach(cleanup)` で DOM の方を必ずきれいにする方を優先しています。

> どちらも正解で、プロジェクトの好みです。「config に `clearMocks: true` を入れるとファイル側で書くことが減って楽」「ファイル側で明示した方がどのテストが何を消しているか追える」のトレードオフがあります。本プロジェクトはバックエンド / フロントエンドで筆者の好みが分かれた、というのが実態です。

### 3.8 セミコロンの有無

これは Vitest とは無関係で、**各サブパッケージの ESLint / Prettier 設定** に従っています。

- `backend/` は ESLint デフォルト寄りでセミコロンあり
- `frontend/` は Vite テンプレートに従ってセミコロンなし

たまたま設定ファイルにも反映されているだけで、テストの動きには一切影響しません。新規にファイルを足すときは、そのサブパッケージの既存ファイルに合わせれば OK。

---

## 4. 「これはどこでも同じ?」 — Vitest 一般の話

本プロジェクト固有の事情を抜きにして、Vitest を使う **どの** フルスタックプロジェクトでも基本的に以下の分岐が出ます:

- **`@vitejs/plugin-react` (または対応フレームワーク用プラグイン)** はフロントエンドだけ。
- **`environment: 'jsdom'` (または `'happy-dom'`)** はフロントエンドだけ。サーバ側は `'node'` のまま。
- **`setupFiles` で `@testing-library/jest-dom` を入れる** のはフロントエンドの定番。
- **`globals: true` を入れるかどうか** はチームの好みで、フロント側で入れるケースが多い (testing-library 公式の例でそうしている影響)。
- **`include` / `exclude` を明示するか** はテスト粒度を分けて並走させているかどうか次第。Unit と Integration を別ランナー / 別 config に分ける構成なら、本プロジェクトのバックエンドと同様に明示が必要になります。

逆に **共通する芯** は:

- `defineConfig({ test: { ... } })` という骨格
- `describe / it / expect / vi` という API
- `clearMocks` / `resetMocks` / `restoreMocks` という状態管理 3 種

なので「`vitest.config.ts` の骨格は同じだが、フロント / バックエンドという**実行環境の違い**から派生して具体的な設定が分かれていく」というのが、Vitest を多重 package で使うときの一般的な姿です。

---

## 5. 関連ドキュメント

- [`vitest-reference.md`](./vitest-reference.md) — Vitest API / 設定の網羅リファレンス (9 章で全設定オプションを解説)
- [`testing-implementation-guide.md`](./testing-implementation-guide.md) — 本プロジェクトでどのテストをどう書いたか
- [`backend-testing-strategy.md`](./backend-testing-strategy.md) — Unit / Integration / E2E の使い分け戦略
- [`react-hono-testing-faq.md`](./react-hono-testing-faq.md) — テスト周りでよくあるつまずきと回答
- 公式: <https://vitest.dev/config/>
