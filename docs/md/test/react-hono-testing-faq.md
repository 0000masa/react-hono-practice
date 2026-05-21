# React + Hono テスト Q&A

このドキュメントは、テストを書き始めるときに浮かびがちな **「そもそも論」の質問** に答えるためのものです。

- 「**何を**書くか」の粒度・戦略 (バックエンド側) → [`backend-testing-strategy.md`](./backend-testing-strategy.md)
- 「**どう**書いたか」「**どう**動かすか」 → [`testing-implementation-guide.md`](./testing-implementation-guide.md)
- 「**Vitest API** のリファレンス」 → [`vitest-reference.md`](./vitest-reference.md)
- 「**ツール選定の理由・フロントエンドの戦略・ビルド時除外** などの周辺論点」 → **このドキュメント**

扱う問い:

1. [React + Hono ではどんなテストツールが使われるのか?](#1-react--hono-ではどんなテストツールが使われるのか)
2. [Hono にはなぜ標準のテストライブラリが同梱されていないのか?](#2-hono-にはなぜ標準のテストライブラリが同梱されていないのか)
3. [フロントエンドも単体・結合テストを書く必要があるのか? E2E だけではダメ?](#3-フロントエンドも単体結合テストを書く必要があるのか-e2e-だけではダメ)
4. [プロジェクト規模でテストの密度はどう変わる?](#4-プロジェクト規模でテストの密度はどう変わる)
5. [テストコードは Docker/CI のビルドに含めないようにすべき?](#5-テストコードは-dockerci-のビルドに含めないようにすべき)

---

## 1. React + Hono ではどんなテストツールが使われるのか?

「Vite + React + Hono + TypeScript」という 2026 年時点のモダンな構成では、ツール選定の選択肢はかなり収斂しています。本プロジェクトで採用しているものを含めてまとめると次の通り。

### 1.1 共通の土台 (フロント/バック両方で使う)

| 役割 | デファクト | 補足 |
|------|-----------|------|
| テストランナー | **Vitest** | Vite と同じトランスパイラ (esbuild) を使うので設定が薄い。Jest と API 互換 (`describe / it / expect / vi`) |
| アサーション | `expect` (Vitest 同梱) | 追加導入不要 |
| カバレッジ | `@vitest/coverage-v8` | Vitest プラグイン。`vitest run --coverage` で出せる |

Vitest を選ぶ理由は「**プロジェクトのビルドツールと同じ esbuild を流用できるから**」です。Jest だと TS/ESM のために `ts-jest` や Babel の追加設定が要りますが、Vitest なら `vitest.config.ts` を 5〜10 行書けば動きます (本プロジェクトの実例: [実装ガイド 4.1](./testing-implementation-guide.md#41-バックエンド))。

### 1.2 バックエンド (Hono) 側

| 役割 | デファクト | 補足 |
|------|-----------|------|
| HTTP テスト | **Hono の `app.request()`** | 実サーバーを起動せずにルーターを直接呼べる。supertest 不要 |
| AWS SDK モック | `aws-sdk-client-mock` | AWS SDK v3 (現行) 専用。S3 / SES / SQS をクラス単位で乗っ取れる |
| 実 DB | Docker Compose の別コンテナ | 本番と同じ MySQL 8.0 を別ポート・別 DB 名で立てる (`mysql-test`) |
| BetterAuth のモック | `vi.mock` でモジュールごと差し替え | OAuth プロバイダの本物経路を通すのは重いのでショートカット |

### 1.3 フロントエンド (React) 側

| 役割 | デファクト | 補足 |
|------|-----------|------|
| DOM テスト環境 | **jsdom** (or happy-dom) | ブラウザを起動せず `document` / `window` を使えるようにする |
| コンポーネントテスト | **@testing-library/react** | React 公式ドキュメント (Testing Recipes) で唯一推奨 |
| ユーザー操作シミュレータ | `@testing-library/user-event` | `fireEvent` より一段現実的 (IME 含めた挙動を再現) |
| DOM 専用マッチャ | `@testing-library/jest-dom` | `toBeInTheDocument` などを追加。失敗メッセージが読みやすい |
| ブラウザ E2E (任意) | **Playwright** または Cypress | 「本物のブラウザで動かす」必要がある場合のみ |

### 1.4 ひとことサマリ

> **「Vitest + Testing Library + Hono `app.request()` + aws-sdk-client-mock + 別コンテナの MySQL」** が現時点の React + Hono プロジェクトの最公約数的なスタック。

Jest や supertest、Cypress、enzyme などの旧来パターンは新規プロジェクトでは選ばれなくなりつつあります (enzyme は React 18+ で実質メンテ停止)。

---

## 2. Hono にはなぜ標準のテストライブラリが同梱されていないのか?

### 2.1 結論

ご指摘の通り、Hono は **テストライブラリを同梱していません**。これは「未対応」ではなく **設計思想として意図的にそうしている** ものです。

Laravel (PHP) や Rails (Ruby) は「**フルスタックフレームワーク**」 — DB ORM・ルーティング・テンプレートエンジン・テストランナー・マイグレーション・キュー処理…すべてが一式で同梱され、設定済みで動きます。`php artisan test` や `rails test` が最初から使えるのはこの世界観の延長です。

一方、Hono は **「ルーティング + ミドルウェア」だけに特化した軽量ライブラリ** です。Express や Fastify の系譜にあり、「**他はユーザーが好きに選んでね**」というスタンスを取っています。テストランナーも例外ではありません。

### 2.2 フルスタック vs ライブラリ比較

| 項目 | Laravel (PHP) | Rails (Ruby) | Hono (TS) | Express (TS) |
|------|---------------|-------------|-----------|--------------|
| 分類 | フルスタックフレームワーク | フルスタックフレームワーク | 軽量ライブラリ | 軽量ライブラリ |
| ORM | Eloquent 同梱 | ActiveRecord 同梱 | 自分で選ぶ (Drizzle / Prisma 等) | 同左 |
| マイグレーション | 同梱 | 同梱 | 自分で選ぶ | 自分で選ぶ |
| テストランナー | PHPUnit 統合済 (`Tests/Unit`, `Tests/Feature`) | Minitest 同梱 (`test/`) | **無し** (Vitest/Jest を自分で入れる) | **無し** |
| HTTP テスト用ヘルパ | `$this->get('/foo')->assertStatus(200)` | `get '/foo'; assert_response :ok` | `app.request('/foo')` (本体機能) | `supertest` を別途導入 |
| DB セットアップ補助 | `RefreshDatabase` トレイト | `fixtures` / `transactional_tests` | 自分で実装 (本プロジェクトの `helpers/db.ts`) | 同左 |

「**テストの書き方に強い意見を持たないこと**」が軽量ライブラリの設計思想です。逆に、Laravel/Rails は「**みんな同じ書き方で揃えること**」が思想なので、フレームワーク側がツール選定をしてくれます。

### 2.3 ただし Hono は HTTP テストの **API そのものは持っている**

「テストライブラリを同梱していない」と言いつつ、Hono には **テストを書きやすくするための仕掛けが本体に組み込まれて** います。それが `app.request()`:

```ts
import app from './app';

const res = await app.request('/api/qrcodes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: 'hello' }),
});
expect(res.status).toBe(201);
```

これは **HTTP サーバーを起動せずに、Hono アプリを「Request を受けて Response を返す関数」として呼び出す** ためのメソッドです。Express で同等のことをするには `supertest` という別ライブラリが必要ですが、Hono は本体にこの機能があるため、テストランナー (Vitest) と組み合わせるだけで結合テスト/E2E が書けます。

つまり Hono は **「テストランナーは選んで」「HTTP の叩き方は用意する」** という分業スタンス。Laravel の `$this->get()` に相当する機能だけは持っており、その手前のテストランナーや DB セットアップは自分で組む、という構成です。

### 2.4 本プロジェクトでの「自前で組んだもの」

参考までに、Laravel が同梱でやってくれることを、本プロジェクトでは以下で代替しています:

| Laravel が同梱 | 本プロジェクトでの実装 |
|---------------|------------------------|
| `Tests/Feature` 用の DB マイグレーション + ロールバック | `backend/src/__tests__/global-setup.ts` + `helpers/schema.sql` + `helpers/db.ts` (`cleanupDb`) |
| `RefreshDatabase` トレイト (各テスト前に DB を初期化) | `beforeEach(cleanupDb)` を各テストファイルで明示呼び出し |
| `$this->actingAs($user)` (認証済み状態にする) | `setSessionUser(TEST_USER)` (`backend/src/__tests__/helpers/auth.ts`) |
| `phpunit.xml` の `<env name="DB_DATABASE" value="testing"/>` | `vitest.integration.config.ts` の `env: { DATABASE_NAME: 'app_test', ... }` |

「組み立てる必要がある分の手間」と「ツール選定の自由」がトレードオフ。本プロジェクトはトレードオフの「自由」側を享受するために Hono を選んだ、と捉えてください。

---

## 3. フロントエンドも単体・結合テストを書く必要があるのか? E2E だけではダメ?

### 3.1 結論

**ご質問の発想 (「E2E を Playwright でやれば十分」) は、規模によっては成立する。ただし通常はそれだけだと足りない。** フロントにも単体テスト・結合 (コンポーネント) テスト・E2E の 3 階層は存在し、組み合わせるのが標準です。

ただし「**バックエンドと**同じくらい厳密に分ける必要はない」のは事実で、バックエンドより少し緩めの構成が一般的です。

### 3.2 フロントエンドのテスト階層

バックエンドの階層 ([backend-testing-strategy.md §3](./backend-testing-strategy.md)) に対応させると、フロントは次のような構造になります。

```
        ▲  少
       ╱E2E ╲              ← Playwright/Cypress で実ブラウザ + 実バックエンド
      ╱──────╲
     ╱コンポーネント╲     ← Testing Library + jsdom (バック結合に相当)
    ╱──────────────╲
   ╱   単体 (Unit)    ╲   ← 純粋関数・hook・ユーティリティ
  ╱──────────────────╲
                      ▼  多
```

| 層 | 対象 | ツール | 速度 | カバー範囲 |
|----|------|--------|------|-----------|
| 単体 | 純粋関数 / ユーティリティ / hook ロジック | Vitest | 数 ms | 計算・整形・変換などのロジックバグ |
| コンポーネント | 1 つの React コンポーネント単独 | Vitest + Testing Library + jsdom | 数十 ms | UI 状態遷移・イベントハンドリング・条件分岐表示 |
| E2E | アプリ全体 (ブラウザ + バックエンド + DB) | Playwright / Cypress | 数秒〜十数秒 | ユーザー導線のハッピーパス |

「コンポーネントテスト」がバックの **結合テスト相当** です — 1 コンポーネントの内部を見るのではなく、**ユーザーが見るレンダリング結果と操作結果** を検証する点で「複数の小さな部品をまたぐ」テストになっています。

### 3.3 E2E だけで済ませると何が困るか

Playwright での E2E が手元にあるからといって、Unit / コンポーネントテストを 0 にすると以下の問題が出ます:

| 問題 | 具体例 |
|------|--------|
| **遅い** | E2E 1 本で数秒。50 本書くと CI が 5 分以上かかる。Unit なら 1000 本で 5 秒 |
| **環境依存で壊れやすい** | ブラウザのレンダリング揺らぎ、ネットワークタイムアウト、CI のマシン性能などで偽陽性が出る |
| **失敗時に原因がわかりにくい** | 「ボタンが押せない」失敗が React の state バグなのか、CSS バグなのか、API のレスポンス形式変更なのか、E2E のスタックトレースだけでは追えない |
| **エラー系を網羅できない** | 「サーバー 500 が返ったら赤いメッセージを出す」のような分岐を、E2E で再現するためにはバックエンドをわざと壊す必要があり、現実的でない |
| **純粋ロジックがカバーされない** | 「カート合計を計算する関数」「日付フォーマッタ」のような UI から見えにくいロジックは、E2E では境界値を網羅できない |

特に **「エラー系の網羅」と「速度」** が決定的です。E2E ピラミッドのアンチパターン (アイスクリームコーン型 — [backend-testing-strategy.md §2](./backend-testing-strategy.md)) はフロントでも全く同じく問題になります。

### 3.4 では、どこに何を書くか — 役割分担

各層が **得意なもの・苦手なもの** で分けるのが基本です。

**単体テスト (純粋関数・hook ロジック)**

- 書く: 計算ロジック、フォーマット関数、バリデーションルール、ステート遷移、URL 組み立て、`useReducer` の reducer 関数
- 書かない: コンポーネントの見た目、API 呼び出しを伴うロジック (→ コンポーネント / E2E へ)
- 例: 本プロジェクトの `frontend/src/lib/__tests__/api.test.ts` (`apiClient` のパラメータ組み立て、401 リダイレクト)

**コンポーネントテスト**

- 書く: フォーム入力 → 送信、エラーメッセージ表示、ローディング表示、条件付きレンダリング、フォーカス管理
- 書かない: 複数ページにまたがるシナリオ、実バックエンドとの結合 (→ E2E へ)
- 例: 本プロジェクトの `frontend/src/components/__tests__/QrCodeGenerator.test.tsx`

**E2E テスト (任意)**

- 書く: ログイン → 機能利用 → ログアウトのような **主要ユースケースのハッピーパス**
- 書かない: 細かいエラー系の網羅、コンポーネント内部の状態
- 1〜5 本に絞ることが多い

### 3.5 「Playwright で E2E」は本プロジェクトに必要か?

本プロジェクトは現状 **フロントの E2E (Playwright) は導入していない**。代わりに `frontend/src/__tests__/` でコンポーネントテストを 14 本書き、バックエンドの E2E 1 本 (`backend/src/__tests__/e2e/qrcode-flow.test.ts`) で「API レイヤーまでの主要フロー」を保証しています ([実装ガイド 1.1](./testing-implementation-guide.md#11-構成と本数))。

この判断の根拠は:

- 学習プロジェクト + 機能 1 つ (QR コード生成) のため、ブラウザレンダリングまで含めた E2E を維持するコストが過大
- ハッピーパスはバックエンド E2E と手動確認で済む
- 将来「ログイン経路の本物確認」「複数ページ遷移の検証」が必要になったら Playwright を追加する

つまり「**プロジェクト規模が小さければ、E2E は省略 or バックエンド側だけで足りる**」という判断を取っています。E2E は最後に追加するのが順番として現実的で、最初から Playwright を入れる必要はありません。

### 3.6 まとめ

| 質問 | 回答 |
|------|------|
| フロントもバックと同じ階層に分けるべき? | **概念は同じだが、3 階層を厳密に維持する必要はない**。フロントはコンポーネントテスト中心、E2E は最小、Unit は純粋ロジックがあるときだけ、で十分なことが多い |
| Playwright だけで済ませてよい? | **No**。E2E だけだと遅い + エラー系を網羅できない + 失敗の原因が掴みにくい |
| 学習プロジェクトでもコンポーネントテストは書いた方がいい? | **Yes**。書く対象を絞れば 14 本程度でも実用的な価値がある (本プロジェクトの実例) |
| Playwright を入れるタイミングは? | コンポーネントテストとバックエンド E2E が一通り揃った後、**かつ「ブラウザでしか再現できないバグ」に困り始めたら** |

---

## 4. プロジェクト規模でテストの密度はどう変わる?

ご想像の通り **規模・性質によって "どこまでやるか" は大きく変わります**。詳しくは [backend-testing-strategy.md §8](./backend-testing-strategy.md) にも書いてありますが、フロントも含めた早見表をここにまとめます。

### 4.1 規模別の推奨ライン

| 規模 | バックエンド | フロントエンド | E2E |
|------|------------|--------------|-----|
| 個人プロトタイプ / ハッカソン | 0 〜 主要ハンドラ 1 本 | 0 〜 主要画面のみ手動確認 | 0 |
| **学習プロジェクト** ← 本プロジェクト | Unit 中心 + 主要 Integration 数本 + E2E 1 本 | コンポーネント 5〜15 本 + 純粋ロジック数本 | バック E2E のみ |
| 小規模 SaaS (本番運用・個人開発) | Unit + Integration + 主要 E2E 1〜3 本 | コンポーネント 30〜50 本 + Playwright 主要シナリオ 3〜5 本 | あり |
| 中〜大規模 (チーム開発・課金あり) | フルピラミッド + CI 強制 + カバレッジ計測 | フルピラミッド + Visual Regression 検査も視野 | あり |
| クリティカル領域 (医療・金融) | フルピラミッド + ミューテーションテスト + 形式検証も検討 | 同左 + アクセシビリティ自動検査 | あり |

### 4.2 規模に依らず **必ず書くべき** ライン

規模に関係なく以下は最低限テストを書くべき部分です ([backend-testing-strategy.md §8.3](./backend-testing-strategy.md) より):

- お金が動くロジック (決済・ポイント計算)
- 認証・権限判定 (誰がどこを見られるか)
- ユーザーデータが消える可能性のある操作 (削除・上書き)
- 複雑な分岐・計算 (税金・割引・日付計算)

逆に、規模に依らず **書かなくてもよい** ものは:

- 設定ファイルの読み込み (起動時にすぐ気づく)
- ライブラリの再 export
- 内部用のデバッグ機能 / 管理画面

### 4.3 判断軸

「壊れたら困る度合い × 壊れやすさ」で考えると外しません:

```
                  ┌─────────────────────────────────┐
       困る度高  │ 必ず書く             │ 必ず書く │
                  │ (計算系・認証)        │ (主要 API) │
                  ├─────────────────────────────────┤
       困る度低  │ 後回しでよい          │ Unit だけ │
                  │ (設定読み込み)        │ 書く        │
                  └─────────────────────────────────┘
                    壊れにくい            壊れやすい
```

ご質問の通り **「規模や機能で厳密さは変わる」が正解** です。むしろ「規模に対して過剰なテスト」は維持コストで足を引っ張るため、最初は薄く始めて、運用しながら「壊れて困った部分」だけ厚くしていくのが現実的です。

---

## 5. テストコードは Docker/CI のビルドに含めないようにすべき?

### 5.1 結論

**ご認識の通り、テストコードは本番ビルドに含めない方が良い**。これは「セキュリティ」「サイズ」「速度」の 3 つの観点から望ましく、業界標準のプラクティスです。

ただし「**何をもって "含めない" とするか**」を分けて考える必要があります。

### 5.2 「含めない」の 3 つのレイヤー

| レイヤー | 何を除外するか | 効果 |
|----------|---------------|------|
| ① 最終成果物から除外 | 本番に出荷される JS バンドル / 静的ファイル | テストコードが本番に紛れ込まない (情報漏洩防止) |
| ② ビルドステージのコンテキストから除外 | Docker の `COPY backend/ ./` に乗らない | ビルド時間短縮 + キャッシュ効率向上 |
| ③ 依存関係から除外 | devDependencies (vitest など) を本番イメージに入れない | イメージサイズ削減 + 攻撃面縮小 |

3 つは独立した工程なので、それぞれ別の手段で対応します。

### 5.3 本プロジェクトの現状分析

#### バックエンド ([docker/ecr/lambda/backend/Dockerfile](../../../docker/ecr/lambda/backend/Dockerfile))

```dockerfile
FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /build
COPY backend/package*.json ./
RUN npm ci                         # ← devDeps (vitest 等) も入る
COPY backend/ ./                   # ← __tests__ も丸ごとコピー
RUN npm run build:lambda           # ← tsc --noEmit + esbuild

FROM public.ecr.aws/lambda/nodejs:22
COPY --from=builder /build/dist/lambda.js ${LAMBDA_TASK_ROOT}/lambda.js
# ... 他のエントリポイントも個別コピー
```

| レイヤー | 現状 | 評価 |
|----------|------|------|
| ① 最終成果物 | `dist/lambda.js` などのエントリポイント単位のバンドルのみコピー。tests は esbuild の入口に含まれないので **最終イメージには入らない** | ✅ OK |
| ② ビルドコンテキスト | `COPY backend/ ./` で **テストも丸ごとコピーされる**。`tsc --noEmit` がテストファイルも型チェックする | ⚠️ 改善余地 |
| ③ 依存関係 | `npm ci` で **devDeps も全部入る**。ただし最終ステージは新規イメージから組み立て直すので **devDeps は最終には残らない** | ✅ OK (マルチステージビルドの恩恵) |

→ **「本番イメージに紛れ込む」リスクは既に回避されている**が、ビルド時間・キャッシュ効率の観点では改善の余地がある。

#### フロントエンド ([.github/workflows/s3-deploy-frontend.yml](../../../.github/workflows/s3-deploy-frontend.yml))

```yaml
- name: Install dependencies and Build
  run: |
    cd frontend
    npm ci
    npm run build      # = tsc -b && vite build
- name: Deploy to S3
  run: aws s3 sync ./frontend/dist s3://${{ env.BUCKET_NAME }} --delete
```

| レイヤー | 現状 | 評価 |
|----------|------|------|
| ① 最終成果物 | `frontend/dist/` を S3 に同期。Vite はエントリポイント (`index.html` → `src/main.tsx`) からの依存グラフだけをバンドルするため、`__tests__/*.test.tsx` は **dist に入らない** | ✅ OK |
| ② ビルドコンテキスト | GitHub Actions の workspace に `frontend/` 全部が乗る (`actions/checkout`)。テストファイルが乗っているが、Vite ビルド時間にはほぼ影響しない | ✅ 問題なし |
| ③ 依存関係 | `npm ci` で devDeps も入るが、`vite build` 後に S3 同期するだけなので **本番環境 (S3 + CloudFront) に node_modules は乗らない** | ✅ OK |

→ フロントエンドは静的サイトデプロイなので、**現状で問題はほぼ無い**。

### 5.4 推奨される改善 (バックエンド)

本プロジェクトのバックエンド側で、**やらなくても安全だが、やった方が綺麗になる** 改善を整理します。

#### 改善 A: `.dockerignore` でテストを Docker コンテキストから除外

リポジトリルートに `.dockerignore` を置く:

```
**/node_modules
**/__tests__
**/*.test.ts
**/*.spec.ts
backend/vitest.config.ts
backend/vitest.integration.config.ts
backend/src/test
docs
```

これにより:

- `COPY backend/ ./` の対象から `__tests__/` などが消える
- Docker のビルドコンテキスト送信量が減る → ビルド開始が速くなる
- `npm run build:lambda` 内の `tsc --noEmit` がテストファイルを型チェックしなくなる → 型チェック時間短縮

#### 改善 B: `tsconfig.json` でテストを exclude

[`backend/tsconfig.json`](../../../backend/tsconfig.json) を更新:

```json
{
  "compilerOptions": { /* 既存設定 */ },
  "exclude": [
    "node_modules",
    "**/__tests__/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "vitest.config.ts",
    "vitest.integration.config.ts"
  ]
}
```

これは Docker 経由でなく **ローカル開発時の `tsc --noEmit`** にも効きます。`.dockerignore` と二重保険になりますが、用途が違うため両方入れるのが安全 (Docker を経由しないテスト実行・型チェックも守れる)。

ただし注意: `vitest` 自体は **このファイルを参照しません** (Vitest は内部的に esbuild で処理する)。`exclude` を入れてもテストは普通に動きます。

#### 改善 C: 本番イメージで devDeps を残さない (現状は不要)

マルチステージビルドの場合、最終イメージはビルダーからファイルをコピーするだけなので、devDeps は最終に乗りません。**本プロジェクトの Dockerfile は既にマルチステージなので、追加対応は不要**。

シングルステージにする場合は `npm ci --omit=dev` (旧 `npm ci --production`) を使うのが定石。

### 5.5 やらない方が良いこと

**「テスト関連のスクリプトを `prebuild` フックに入れる」のは避ける**:

```json
// 悪い例
"scripts": {
  "prebuild": "npm test",
  "build": "tsc && esbuild ..."
}
```

理由:

- ビルド (= 本番デプロイ) のたびにテストが走る → 1 つでも壊れているとデプロイ不可
- テストの責務は CI で担保すべきもの。ビルドステップに混ぜると関心が混ざる
- Docker ビルドステージでテストを走らせると、DB 接続などが必要なテストが詰むケースが多い

正解は **「CI で `npm test` を別ジョブとして走らせる」 → 通ったら `docker build` する** の流れに分けることです (本プロジェクトの GitHub Actions ワークフローも別ジョブ化を想定)。

### 5.6 まとめ

| 質問 | 回答 |
|------|------|
| テストコードは本番ビルドに含めないべき? | **Yes**。3 つのレイヤー (最終成果物 / ビルドコンテキスト / 依存関係) で考える |
| 本プロジェクトの現状は? | **最終成果物には入っていない** (マルチステージビルドとエントリポイント bundling のおかげ)。ビルドコンテキストには乗っているので改善の余地あり |
| 改善するならどう? | (A) `.dockerignore` + (B) `tsconfig.json` の `exclude` を入れるのが定石 |
| テストをビルドフックで走らせるべき? | **No**。CI の別ジョブとして分離するのが正しい責務分離 |

---

## 関連ドキュメント

- [`backend-testing-strategy.md`](./backend-testing-strategy.md) — テスト粒度の戦略 (バックエンド中心の "なぜ" を扱う)
- [`testing-implementation-guide.md`](./testing-implementation-guide.md) — 本プロジェクトに実装したテストの記録・ファイル一覧・実行方法
- [`vitest-reference.md`](./vitest-reference.md) — Vitest API の辞書的リファレンス
