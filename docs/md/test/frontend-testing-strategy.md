# フロントエンドテスト戦略ガイド

このドキュメントは [`backend-testing-strategy.md`](./backend-testing-strategy.md) の **フロントエンド版**です。「テストの書き方」ではなく **「テストをどの粒度で分けるか / どこまで書くか」** を扱います。React・Vue・Svelte など特定のフレームワークに依存しない一般論を先に整理し、後半で本プロジェクト (React + Vite + Testing Library) への適用例を示します。

本プロジェクトでは `frontend/src/components/__tests__/QrCodeGenerator.test.tsx` 1 本しかコンポーネントテストがありません。「**全コンポーネントをテストしないのは何故か**」「**プロジェクト規模でテストの密度はどう変わるのか**」── この 2 つの疑問への直接の答えは §7 にあります。

実際のテストコードの書き方 (jsdom 環境のセットアップ、`userEvent.setup()` の作法、`vi.mock` の書式など) は [`testing-implementation-guide.md`](./testing-implementation-guide.md) §5.5〜§5.7 を参照してください。

---

## 1. なぜテストを分けるのか

テストには **速さ・壊れにくさ・原因の切り分けやすさ** という相反する性質があり、1 種類のテストだけで全部を満たせません。これはバックエンドと同じ構図ですが、フロントエンドは **「状態 × イベント × DOM」の組み合わせ爆発が大きい**ため、特に「速度」と「失敗時の原因特定」のバランスが効いてきます。

| 観点 | 全部を E2E (Playwright 等) で書くと | 全部を Unit で書くと |
|------|-------------------------------|-------------------|
| 速度 | 1 本数秒〜十数秒。CI が分単位で延びる | 数百本でも数秒、watch で常時回せる |
| 壊れやすさ | ブラウザレンダリング揺らぎ・ネットワークで偽陽性 | 安定するが、ユーザーの実体験から乖離 |
| 失敗時の原因特定 | 「ボタンが押せない」が state バグか CSS か API か追えない | 失敗箇所がそのままバグ箇所 |
| カバーできる範囲 | ユーザー導線全体・実バックエンドとの結合 | 個別ロジックのみ。レンダリングと操作の結合バグは取れない |

そこで **粒度の違うテストを組み合わせる** のが定石です。

---

## 2. テストピラミッド (フロントエンド版)

バックエンドと同じく「下が広く、上にいくほど少ない」ピラミッド型を目指します。階層名はバックエンドと対応するように選んでいます。

```
        ▲  少
       ╱ E2E ╲              ← Playwright/Cypress で実ブラウザ + 実バックエンド
      ╱───────╲
     ╱コンポーネント╲       ← Testing Library + jsdom (バックの Integration 相当)
    ╱──────────────╲
   ╱  単体 (Unit)    ╲      ← 純粋関数・ユーティリティ・分離されたフックロジック
  ╱──────────────────╲
                      ▼  多
```

| バック側 | フロント側 | 対応関係 |
|---------|----------|---------|
| Unit | Unit | ほぼ同じ。純粋ロジックを単独で検証 |
| Integration (実 DB + ルーター) | **Component** (jsdom + Testing Library) | 「複数の小さな部品をまたぐ」「ユーザー視点で振る舞いを検証する」点で同じ役割 |
| E2E (実 DB + 認証経路) | E2E (実ブラウザ + 実バックエンド) | 主要導線のハッピーパス保証 |

数の目安は **Unit : Component : E2E ≒ 70 : 20 : 10** あたりがよく挙げられますが、フロントは「Unit に切り出せる純粋ロジックが少ない」プロジェクトもよくあり、その場合は **Component : Unit : E2E ≒ 60 : 30 : 10** のように Component が主役になることもあります。厳密な比率より「下にいくほど速くて多い」性質を保つことが重要です。

アンチパターン: **アイスクリームコーン型** (E2E ばかり多く、Unit が少ない) は、フロントでも CI を遅くし原因切り分けを難しくします (バックエンド §2 と同じ罠)。

---

## 3. 各レイヤーの責務

### 判断軸: 「どこまでを本物にするか」

3 つのレイヤーを分ける本質的な軸は、**「どこを本物のまま通して、どこをモックで止めるか」** にあります。

| | スコープ | DOM | API 通信 | ブラウザ | バックエンド |
|---|---------|-----|---------|----------|-----------|
| Unit | 1 関数・1 フック | 不要 (or jsdom) | モック | — | — |
| Component | 1 コンポーネント単独 | **jsdom (本物に近い)** | モック | jsdom | モック |
| E2E | アプリ全体 | **実ブラウザ** | **実通信** | 実物 (Chromium 等) | **実物 (テスト用)** |

「コンポーネントテスト = バックの結合テスト相当」と言われるのは、**「1 つの関数を見る」のではなく「複数の要素をまたいでユーザーが見る振る舞いを検証する」** からです。コンポーネント内では `useState` / `useEffect` / 子コンポーネント / フォーム要素が連動して動いており、それらをまとめて 1 つの「観察対象」として扱います。

### 3.1 単体テスト (Unit)

- **対象**: 純粋関数・ユーティリティ・分離されたフックロジック・`useReducer` の reducer
- **外部依存**: API・ストレージ・現在時刻・乱数・グローバル変数はすべてモック
- **速度**: 1 本あたり 数 ms 〜 10 ms
- **数**: 数十〜数百本書ける
- **狙い**: 計算・整形・バリデーションルール・ステート遷移のロジックバグを高速に検出

```ts
// 例: 純粋関数の Unit テスト
import { formatCurrency } from "../utils/format";

it("3 桁区切りで通貨表示にする", () => {
  expect(formatCurrency(1234567)).toBe("¥1,234,567");
});
```

**ポイント**: 「DOM もブラウザも不要」のロジックがフロントには意外と多くあります (バリデーション・URL 組み立て・日付計算・state 遷移)。**それらをコンポーネントから切り出すと、Unit でカバーできる面積が増える** ── これが §5 でも触れる設計原則の出発点です。

### 3.2 コンポーネントテスト (Component)

- **対象**: 1 つの React コンポーネントの振る舞い (props 入力 → イベント → レンダリング結果)
- **外部依存**: API クライアントはモック・DOM は jsdom (実 DOM ではなく仕様準拠の Node 実装)
- **速度**: 1 本あたり 数十 ms 〜 100 ms
- **数**: 主要画面ごとに 1〜数本
- **狙い**: フォーム送信フロー・条件付きレンダリング・エラー表示の分岐・カスタムイベント発火など、UI と状態の結合バグを潰す

コンポーネントは性質によって優先度が大きく変わります。本プロジェクトに登場する典型を 5 種類に分類しておきます。

| 分類 | 例 | 優先度 | 何を assert するか |
|------|-----|------|-----------------|
| ① フォーム入力 → API → 表示 | `QrCodeGenerator`, `MailSender` | **高** | 入力 → 送信 → API 呼び出し引数 → 成功/失敗メッセージの表示 |
| ② 一覧表示 (データ取得 + ページング) | `QrCodeList`, `UserList` | 中 | API 失敗時のエラー表示、ページ遷移、空状態 |
| ③ レイアウト / ナビゲーション | `Layout` | 低 | ログアウトボタン押下、認証状態に応じた表示切替 |
| ④ 認証ガード | `ProtectedRoute` | **高** | 未認証時のリダイレクト、認証済み時の通過 |
| ⑤ 表示専用 (presentational) | アイコン / バッジ / カード | 低 | 通常はテスト不要 (props 入れて DOM が出るだけ) |

①と④は **「壊れたらユーザーに直接迷惑がかかる」** ため、規模に関係なく最初に書きます。⑤は規模が大きくなって Visual Regression を入れるまでは普通テストしません。

### 3.3 E2E テスト

- **対象**: 実ブラウザ (Chromium / Firefox / WebKit) でアプリ全体をロードし、実バックエンドと通信する
- **外部依存**: バックエンドはテスト用環境 (本プロジェクトなら `mysql-test`)、外部 SaaS のみモック
- **速度**: 1 本あたり数秒〜十数秒
- **数**: 主要フローのハッピーパス中心に 1〜5 本
- **狙い**: ブラウザ固有のバグ (CSS レイアウト・フォーカス管理・実ネットワーク経路) と、認証込みのユーザー導線をエンドツーエンドで保証

ツール: Playwright (新規プロジェクトのデファクト) / Cypress (旧来も多い)。

> **本プロジェクトでは未導入**。理由は §7.2 で触れますが、要約すると「学習プロジェクト + 機能 1 つ (QR コード生成) のためブラウザ E2E を維持するコストが過大」「バックエンド E2E 1 本 (`backend/src/__tests__/e2e/qrcode-flow.test.ts`) で API レイヤーまでの主要フローは保証済み」── という判断です。

---

## 4. 「振る舞いを検証する」とは何か

フロント固有の最重要原則。Testing Library の思想に沿って **「ユーザーが見るもの・操作するもの」を起点に assert** し、**実装詳細 (state 名・CSS クラス・DOM 構造) には依存しない** テストを書きます。

### 4.1 良いテスト vs 壊れやすいテスト

```tsx
// ❌ 実装詳細に依存 (壊れやすい)
expect(container.firstChild?.firstChild?.textContent).toBe("QRコードを生成しました");
expect(component.state.success).toBe(true);
expect(wrapper.find(".success-message-text-2024-v3")).toHaveLength(1);

// ✅ ユーザー視点 (壊れにくい)
expect(screen.getByText("QRコードを生成しました")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /生成/ })).toBeEnabled();
```

下のテストは:
- リファクタで DOM 構造が変わっても通る
- CSS クラス名が変わっても通る
- 内部 state の変数名を変えても通る
- でも「ユーザーが成功メッセージを見られなくなった」場合は確実に落ちる

「**何が壊れたら落とすか / 何が変わっても落とさないか**」を意識して書くと、テストはリファクタの邪魔にならず、本物のバグだけを捕まえます。

### 4.2 「モックしすぎたテスト」のフロント版

バックエンド戦略 §7 の「コードを書き写しただけのテスト」と同じ罠がフロントにもあります。

```tsx
// ❌ アンチパターン: 子コンポーネントを片っ端からモック
vi.mock("../QrCodeList", () => ({ default: () => <div>mocked</div> }));
vi.mock("../QrCodeGenerator", () => ({ default: () => <div>mocked</div> }));
// → ページコンポーネントの「何を」テストしているのか分からなくなる
```

判断目安: **自プロジェクト内のコンポーネントは基本モックしない**。子コンポーネントごと一緒に render し、「画面に出る最終結果」で assert します。モックを足したくなったら「外部依存 (HTTP・認証・グローバル) だけ」に絞れているか見直します。

---

## 5. テストしやすいコンポーネント設計

「テストが書きづらい = 設計を見直すサイン」。これはバックエンド戦略 §6 と全く同じ命題です。フロント固有のポイントは 4 つ。

1. **ロジックをカスタムフックや純粋関数に切り出す**
   - 「日付フォーマット」「URL クエリ組み立て」「フォームバリデーション」をコンポーネントの外に出すと、Unit で網羅できる
   - 本プロジェクトの `useAuth` はその好例 (フックとして単独テスト可能)

2. **API 通信は薄いクライアント層 (apiClient) に集約**
   - コンポーネントから `fetch` を直接呼ばず、`apiClient.post(...)` のような関数経由にする
   - テストでは `vi.mock('../lib/api', ...)` の 1 行で全コンポーネントの HTTP を止められる
   - 本プロジェクトの `frontend/src/lib/api.ts` はこの形

3. **表示と取得を分ける (Container / Presentational パターンの現代版)**
   - 「データを取得するコンポーネント」と「props を受けて描くコンポーネント」を分けると、後者は Unit に近い軽さでテストできる
   - 必須ではないが、複雑な画面では効く

4. **Context は「Provider つき render ヘルパ」を用意する**
   - `<AuthProvider>` を毎回手で書くと冗長。`renderWithAuth(ui)` のような薄いヘルパを 1 つ作る
   - 本プロジェクトは現状ヘルパを切り出していないが、今後コンポーネントテストが増えたら検討

逆に言うと、**「フックの外でロジックが走っている」「fetch が直接呼ばれている」「Context のセットアップが毎テスト 20 行ある」** といった兆候はテストが書きづらくなる赤信号です。

---

## 6. モック対象の方針

### モックすべき依存

| 依存 | 理由 |
|------|------|
| `apiClient` (HTTP 通信) | 本物の API を叩くと遅い・不安定・テスト用バックエンドが必要になる |
| `authClient` (BetterAuth 等) | OAuth プロバイダの本物経路はテストで通せない |
| `window.location` / `fetch` などのグローバル | 副作用 (ページ遷移) が他テストに漏れる |
| 現在時刻 / 乱数 | アサート不能 (毎回値が変わる) |

### モックすべきでない依存

| 依存 | 理由 |
|------|------|
| 自プロジェクト内の子コンポーネント | モックするとテスト対象が空洞化 (§4.2) |
| jsdom 標準の DOM API (`document` / `localStorage`) | 本物に近い動きをするので使ってよい |
| React の `useState` / `useEffect` 等 | フレームワーク本体は信頼してよい |

### グローバル差し替えの定型

| 何を差し替えるか | 書き方 |
|--------------|--------|
| `globalThis.fetch` | `vi.stubGlobal('fetch', vi.fn())` + `afterEach(() => vi.unstubAllGlobals())` |
| `window.location` | `Object.defineProperty(window, 'location', { ... })` (jsdom では read-only) |
| カスタムイベント (`window.dispatchEvent`) | `window.addEventListener('xxx', handler)` を貼って `try/finally` で外す |
| ルーター (`useNavigate` 等) | `<MemoryRouter>` で囲む |

本プロジェクトの `frontend/src/lib/__tests__/api.test.ts` で実際にこれらの定型が使われています ([testing-implementation-guide.md §5.5](./testing-implementation-guide.md#55-frontend-unit-apiclient-を-fetch-モックで))。

---

## 7. すべてのコンポーネントを必ずテストするか — プロジェクト規模と取捨選択

### 7.1 結論: しない。「壊れたら困る度合い」 × 「壊れやすさ」で決める

バックエンド戦略 §8 と全く同じ判断軸です。3 種類のテスト (Unit / Component / E2E) は **すべて書ければベスト** ですが、書く時間・メンテ時間もかかります。どこまでやるかは:

- 壊れたらユーザーに迷惑がかかる部分 → テストを手厚く
- 壊れても影響が小さい / すぐ気づける部分 → テストを省略 or 後回し

で決めます。**「全コンポーネントをテストする」のは中〜大規模以降の発想**で、学習プロジェクト〜小規模 SaaS の段階では過剰投資です。

### 7.2 規模ごとの典型パターン

| 規模 | Component テスト本数目安 | Unit | E2E (Playwright 等) | 追加で検討するもの |
|------|--------------------|------|------------------|--------------|
| 個人プロトタイプ / ハッカソン | 0 | 0 | 0 | — |
| **学習プロジェクト** ← 本プロジェクト | **1〜5 本** (代表コンポーネント) | 0〜数本 (純粋ロジックがあれば) | 0 (バック E2E のみで十分) | — |
| 小規模 SaaS (本番運用) | 主要画面ごとに 1〜2 本 (累計 10〜30 本) | あり | 主要シナリオ 3〜5 本 | — |
| 中〜大規模 (チーム開発・課金あり) | 全主要コンポーネント (50 本〜) | あり | あり | Storybook / MSW / Visual Regression を視野に |
| クリティカル (医療・金融) | 上記 + アクセシビリティ強制 | あり | あり | axe-core 等の a11y 自動検査 |

> **未導入ツールの位置づけ**: Playwright (実ブラウザ E2E) / MSW (API モック) / Storybook (コンポーネントカタログ) / Visual Regression (`@chromatic-com` / `playwright --screenshot` 等) / axe-core (アクセシビリティ自動検査) は本プロジェクトでは使っていません。**規模が育って必要になった時に追加検討**するものとして、名前だけ覚えておけば十分です。

「規模が大きくなるほど、自分が把握しきれない部分が増える」── それを補うために自動テストの密度を上げます。逆に小さく短命なコードに分厚いテストを書くのは過剰投資です。

### 7.3 「これは書く / これは書かなくていい」のフロント版

**必ず書くべき**:
- フォーム送信 → API → 結果表示の往復 (バリデーション含む) ── ユーザーがエラーに気づけないバグは致命的
- 認証ガード (`ProtectedRoute` / `useAuth`) ── 権限制御が崩れると別ユーザーのデータが見える
- エラー表示 / ローディング表示の分岐 ── 「API 失敗時に何も表示されない」は最悪体験
- ユーザーデータが消える操作の確認動線 (削除モーダル等)
- 複雑な計算・整形 (カート合計・税込価格・日付計算)

**書かなくていい / 後回しでよい**:
- 表示専用コンポーネント (props を受けて DOM を返すだけ) ── 壊れたら手動確認ですぐ気づく
- ライブラリラッパー (UI フレームワークの薄い再 export)
- 一覧 / ナビゲーションの単純な表示
- 管理画面・内部用デバッグ画面
- 「同じパターンの 2 個目以降のフォーム」── 1 個目で守れていれば、2 個目はパターン横展開なのでスキップ可

### 7.4 本プロジェクトのテスト本数と判断

ここでユーザーの当初の疑問 (「QrCodeGenerator 1 本だけなのは何故か」) に答えます。

**現状のテスト構成** ([`testing-implementation-guide.md §1.1`](./testing-implementation-guide.md#11-構成と本数) より):

| 種別 | ファイル | 本数 |
|------|---------|------|
| Unit (lib) | `frontend/src/lib/__tests__/api.test.ts` | 6 |
| Unit (フック) | `frontend/src/hooks/__tests__/useAuth.test.tsx` | 4 |
| Component | `frontend/src/components/__tests__/QrCodeGenerator.test.tsx` | 4 |
| **Component 合計** | | **4 本 (1 ファイル)** |

これは §7.2 の「学習プロジェクト = 1〜5 本」のラインに収まっています。

**各コンポーネントの判断根拠**:

| コンポーネント | 分類 (§3.2) | テスト有無 | 判断 |
|--------------|----------|---------|------|
| `QrCodeGenerator` | ① フォーム + API | ✓ あり | **代表として採用**。フォーム入力・送信・成功/失敗表示・カスタムイベント発火という「フォーム系の典型挙動」を 1 本でカバー |
| `QrCodeAsyncGenerator` | ① フォーム + API | スキップ | `QrCodeGenerator` と同種 (非同期版)。§7.3 の「同じパターンの 2 個目以降」に該当 |
| `MailSender` | ① フォーム + API | スキップ | 同上。フォームの典型挙動は `QrCodeGenerator` で守られている |
| `QrCodeList` | ② 一覧表示 | スキップ | 一覧表示中心。壊れたら手動確認で気づく。本番運用フェーズに入ったら追加検討 |
| `UserList` | ② 一覧表示 | スキップ | 同上 |
| `Layout` | ③ レイアウト | スキップ | 表示中心 + ログアウトボタンのみ。手動確認で十分 |

**まとめ**:
- 「全 6 コンポーネントをテストする」のは **§7.2 の「中〜大規模」相当の密度**で、学習プロジェクトには過剰
- 「最も重要な 1 つを 1 本」が学習プロジェクトの最小ゴール (§7.2 の下限ライン)
- 将来「QR 一覧の表示バグで困った」「メール送信で頻繁にエラーが出る」など実際の痛みが出たら、その都度該当コンポーネントにテストを足していくのが現実的

「最初から完璧を目指さず、痛みが出た部分を後追いで守る」のがメンテ可能なライン。

---

## 8. 本プロジェクトへの適用

本プロジェクトのフロントエンド構造 (`frontend/src/`):

```
components/    フォーム / 一覧 / レイアウト
  ↓
pages/         ルート単位のページコンポーネント
  ↓
hooks/         useAuth など
  ↓
contexts/      AuthContext (BetterAuth のセッション)
  ↓
lib/           apiClient (HTTP 抽象) / authClient (BetterAuth ラッパ)
```

外部依存: **バックエンド API (`apiClient`)**、**BetterAuth (Google OAuth)**、**ブラウザの `window` / `document` / `localStorage`**。

### 8.1 レイヤー対応表

| レイヤー / 対象 | テスト種別 | 外部依存の扱い | 置き場所 |
|--------------|---------|------------|--------|
| 純粋関数 / ヘルパ | Unit | — | `src/{lib,utils}/__tests__/` |
| カスタムフック (`useAuth` 等) | Unit (`renderHook`) | `authClient` / `apiClient` をモック | `src/hooks/__tests__/` |
| フォーム系コンポーネント | Component | `apiClient` をモック | `src/components/__tests__/` |
| ページコンポーネント (任意) | Component | `apiClient` + ルーターをモック | `src/pages/__tests__/` |
| 認証 Context (`AuthProvider`) | Unit (Provider 経由で `useAuth` を検証) | `authClient` をモック | `src/contexts/__tests__/` (現状未作成) |
| アプリ全体 (実ブラウザ) | E2E | — (未導入) | — |

### 8.2 外部依存の扱い方針

| 依存 | Unit | Component | E2E (理想形) |
|------|------|----------|------------|
| `apiClient` (HTTP) | モック | モック | 実通信 |
| `authClient` (BetterAuth) | モック | モック | 実通信 (OAuth 経路) |
| `window.location` | `Object.defineProperty` で差し替え | 必要なら同左 | 実物 |
| `globalThis.fetch` | `vi.stubGlobal` | 同左 | 実物 |
| `react-router` | — | `MemoryRouter` で囲む | 実物 |
| `localStorage` / `sessionStorage` | jsdom 既定で動く | 同左 | 実物 |
| カスタムイベント (`qrcode-created` 等) | — | `addEventListener` で監視 | 実物 |

### 8.3 疑似コード (最小例)

実装の深掘りは [`testing-implementation-guide.md`](./testing-implementation-guide.md) §5.5〜§5.7 にあるため、ここでは「形」だけ示します。

**Unit: 純粋関数の入出力検証**

```ts
import { describe, it, expect } from "vitest";
import { formatBytes } from "../utils/format";

describe("formatBytes", () => {
  it("KB / MB / GB の単位を切り替える", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
```

**Component: フォーム送信のハッピーパス**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("../../lib/api", () => ({
  default: { post: vi.fn().mockResolvedValue({ status: 201 }) },
}));
import apiClient from "../../lib/api";
import MyForm from "../MyForm";

it("送信すると API が叩かれ成功メッセージが出る", async () => {
  const user = userEvent.setup();
  render(<MyForm />);
  await user.type(screen.getByLabelText(/データ/), "hello");
  await user.click(screen.getByRole("button", { name: /送信/ }));
  expect(apiClient.post).toHaveBeenCalledWith("/items", { data: "hello" });
  expect(await screen.findByText("送信しました")).toBeInTheDocument();
});
```

**E2E (理想形 / Playwright)**

```ts
import { test, expect } from "@playwright/test";

test("ログイン → QR 作成 → 一覧で見える", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /Google でログイン/ }).click();
  // ... OAuth 経路を本物 or モックサーバーで通す
  await page.goto("/qrcodes");
  await page.getByLabel("データ").fill("https://example.com");
  await page.getByRole("button", { name: /生成/ }).click();
  await expect(page.getByText("https://example.com")).toBeVisible();
});
```

---

## 9. テストしすぎの罠

フロントで特に起きやすいアンチパターンを 3 つ。

1. **スナップショットテストの濫用**
   `expect(container).toMatchSnapshot()` を全コンポーネントに付けると、DOM が変わるたびに `--update-snapshot` を叩くだけのテストになり、**バグを止める力を持たなくなる**。本当に「DOM 構造そのものが契約」になっている場面 (デザインシステムの基本パーツ等) だけに留める。

2. **実装詳細への依存**
   §4.1 で触れた通り、`state.success` や `.css-class-name` で assert すると、リファクタのたびにテストが赤くなる。Testing Library のクエリ (`getByRole` / `getByLabelText` / `getByText`) を優先する。

3. **モックだらけでコードを書き写しただけのテスト**
   バックエンド戦略 §7 と同じ罠。`vi.mock` を 10 個積んだ結果、テストが「コンポーネントの内部呼び出しを書き写しただけ」になり、**実際のバグは見つけてくれないがリファクタで一斉に壊れる** 状態になる。判断目安: 「ユーザーが見る最終結果」を 1 つ以上 assert しているか。

---

## 10. 推奨ツール

本プロジェクトで採用しているものに絞って整理 (詳細は [`testing-implementation-guide.md §2`](./testing-implementation-guide.md#2-使っているツールと役割) と [`vitest-config-front-vs-back.md`](./vitest-config-front-vs-back.md))。

| 用途 | 採用 | 役割 |
|------|------|------|
| テストランナー | **Vitest** | TS / ESM ネイティブ、Vite と同じ esbuild を共有、watch が速い |
| DOM 環境 | **jsdom** | Node 上で `document` / `window` を提供。`environment: 'jsdom'` で有効化 |
| コンポーネント描画 | **@testing-library/react** | React 公式が唯一推奨。`render` / `screen` |
| ユーザー操作 | **@testing-library/user-event** | `fireEvent` より一段現実的。`await user.type(...)` / `user.click(...)` |
| DOM マッチャ | **@testing-library/jest-dom** | `toBeInTheDocument` / `toBeDisabled` 等を追加。失敗メッセージが読みやすい |

未導入ツールは §7.2 の規模ライン参照。設定ファイルの実物は `frontend/vitest.config.ts` と `frontend/src/test/setup.ts`。

---

## 11. 何から始めるか

§7.4 で示した推奨ラインを最終目標に、段階的に積み上げます。いきなり全コンポーネントに手をつけず、以下の順序が現実的です。

1. **最も壊れたら困るフォームを 1 本コンポーネントテストで守る** ── 道具と書き味に慣れる (本プロジェクトの `QrCodeGenerator.test.tsx` がここに相当)
2. **ロジック分離されたフックを Unit で 1 本書く** ── `renderHook` の使い方を覚える (本プロジェクトの `useAuth.test.tsx`)
3. **規模が育ったら** 一覧 / レイアウト / ページコンポーネントに横展開する
4. **ブラウザ固有のバグに困り始めたら** Playwright を追加検討する (= ここで初めて E2E が登場)

最初の 1 本を書くまでが一番大変で、書いた後は同じパターンの横展開になります。**まずはフォーム 1 本** を最小ゴールにして取り組むのが進めやすいです。

---

## 関連ドキュメント

- [`backend-testing-strategy.md`](./backend-testing-strategy.md) — バックエンドのテスト戦略 (本ドキュメントの対)
- [`react-hono-testing-faq.md`](./react-hono-testing-faq.md) — テストツール選定の "なぜ"。§3 / §4 にもフロントの 3 階層・規模別ラインが Q&A 形式で書かれている (本ドキュメントと同じ結論)
- [`testing-implementation-guide.md`](./testing-implementation-guide.md) — 本プロジェクトに実装したテストの実装例 (§5.5〜§5.7 がフロント)
- [`vitest-config-front-vs-back.md`](./vitest-config-front-vs-back.md) — フロント / バックの Vitest 設定の差分とその理由
- [`vitest-reference.md`](./vitest-reference.md) — Vitest API の辞書的リファレンス
