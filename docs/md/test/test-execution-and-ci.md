# テスト実行と CI/CD 統合ガイド

このドキュメントは、本プロジェクトで **「テストを `npm test` で動かすときの正しい手順」** と **「GitHub Actions に組み込むときの設計指針」** をまとめたものです。テスト戦略 (何をテストすべきか) は [`backend-testing-strategy.md`](./backend-testing-strategy.md) / [`frontend-testing-strategy.md`](./frontend-testing-strategy.md) に分けて書いています。

## このドキュメントの目的と読み方

よくある 4 つの問いに対する **結論を先出し** します。詳細は各章で。

| 問い | 一言での結論 | 詳細 |
|------|-----------|------|
| フロント/バックのテスト実行コマンドは? | **対象ディレクトリで `npm test` / `npm run test:integration`** | §1 |
| CI/CD にどう組み込むか? | **`.github/workflows/test.yml` を新規追加。PR と main の push をトリガーに分ける** | §2〜§4 |
| PR 作成時に走らせるべきか? | **走らせるべき。ただし Unit + フロントのみ (高速・DB 不要)** | §2.3 / §3.2 |
| デプロイ workflow にテストコマンドを入れるべきか? | **入れない。テストと配送を分離する** | §5 |

---

## 1. ローカルでのテスト実行

### 1.1 全体像

| コマンド | 実行ディレクトリ | 種別 | 外部前提 | 目安時間 |
|---------|--------------|------|--------|--------|
| `npm test` | `backend/` | Unit (services) | 無し | 1 秒以内 |
| `npm run test:watch` | `backend/` | Unit (watch モード) | 無し | — |
| `npm run test:integration` | `backend/` | Integration + E2E | **mysql-test コンテナ起動済み** | 5〜10 秒 |
| `npm test` | `frontend/` | Unit + Component | 無し | 2〜3 秒 |
| `npm run test:watch` | `frontend/` | Unit + Component (watch) | 無し | — |

#### 補足: `vitest run` と `vitest` (引数なし) の違い

上の表で `npm test` は `vitest run` を、`npm run test:watch` は `vitest` を実行しています (`backend/package.json` / `frontend/package.json` 参照)。両者の差は **「1 回走って終わるか / ファイル監視で常駐するか」** の 1 点だけです。

| コマンド | 動作 | 終了するか | 使う場面 |
|---------|------|---------|--------|
| `vitest run` | 全テストを 1 回実行 → 結果を出力 → プロセス終了 (exit code 0 = pass / 非 0 = fail) | 終了する | **CI**・**ワンショット確認**・**コミット前チェック** |
| `vitest` (引数なし) | 全テストを 1 回実行 → ファイル監視モードに入り、保存のたびに関連テストを再実行 | 終了しない (Ctrl+C で抜ける) | **開発中の常駐**・エディタの裏で動かしっぱなし |

`vitest` (引数なし) は内部的に `vitest --watch` と等価。watch モードでは依存グラフを解析して **「変更されたファイルに関係するテストだけ」** を再実行するので、数百本のテストがあっても保存ごとの再実行は数百 ms で終わります。

> **注意**: CI で `vitest` (引数なし) を叩くと watch モードに入って永遠に終わらず、ジョブがタイムアウトします。CI ・スクリプト・他のコマンドからの呼び出しは **必ず `vitest run`** を使うこと (`§4.1` の `.github/workflows/test.yml` でも `npm test` 経由で `vitest run` を呼んでいます)。

`package.json` の `scripts` がこの慣習に従い、`test` (1 回実行) と `test:watch` (監視モード) の 2 種類を分けて用意しているのもこのためです。

#### 補足: バックエンドの `vitest run` と `vitest run --config vitest.integration.config.ts` の違い

`backend/package.json` の `scripts` には **`vitest run` を 2 種類** 並べています:

```json
"test": "vitest run",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

どちらも「1 回実行して終わる」という挙動 (= 前述の `vitest run`) は同じで、違うのは **どの設定ファイルを使うか** だけ。Vitest はデフォルトで `vitest.config.ts` を読みますが、`--config` を渡すと別の設定ファイルに切り替えられます。

| 観点 | `vitest run` (= `npm test`) | `vitest run --config vitest.integration.config.ts` (= `npm run test:integration`) |
|------|-------------------------|----------------------------------------------------------------------|
| 読む設定ファイル | `backend/vitest.config.ts` | `backend/vitest.integration.config.ts` |
| 対象テスト | `src/**/*.test.ts` (`__tests__/integration` と `__tests__/e2e` は **exclude**) | `src/__tests__/integration/**/*.test.ts` と `src/__tests__/e2e/**/*.test.ts` のみ |
| 実行モード | 並列 (Vitest 既定) | **直列** (`fileParallelism: false` + `pool: 'forks'` + `singleFork: true`) |
| `testTimeout` | 5 秒 (既定) | **30 秒** に延長 |
| `hookTimeout` | 10 秒 (既定) | **60 秒** に延長 |
| `globalSetup` | 無し | `src/__tests__/global-setup.ts` (mysql-test の起動待ち + schema 投入) |
| 環境変数の注入 | 無し (`.env` をそのまま読む) | `env:` ブロックで `DATABASE_PORT=3307` `DATABASE_NAME=app_test` 等を上書き |
| 外部依存 | すべてモック (DB / AWS / Auth) | DB は **実物 (mysql-test)**、AWS と Auth はモック |
| 想定速度 | 1 秒以内 (10 本程度) | 5〜10 秒 (7 本) |

なぜ 2 つに分けているか:
- **直列実行が必要** ── Integration / E2E は同じ MySQL を共有するため、並列で書き込むとレコード競合が起きる。設定を別ファイルにしないと、Unit テストまで直列化されてしまい遅くなる
- **タイムアウトの違い** ── DB 起動待ち (`globalSetup`) や実 SQL 発行は秒単位かかる。Unit と同じ 5 秒上限だと不安定になる
- **環境変数の差** ── テスト用 DB (`app_test`, port 3307) は本番用 DB と分離するため、テスト実行時のみ env を上書きする必要がある

両方を 1 つの `vitest.config.ts` に詰め込もうとすると、上記の差分を `if (process.env.MODE === 'integration')` のような分岐で書くことになり、可読性が落ちる ── ので **設定ファイル自体を 2 個に分ける** のが Vitest 公式の推奨パターン。フロントエンドは差分が少ないので 1 ファイルで済んでいます。

設定ファイルの完全な差分は [`vitest-config-front-vs-back.md`](./vitest-config-front-vs-back.md) を参照。

実装の詳細 (各テストファイルの中身や `vi.mock` の書き方) は [`testing-implementation-guide.md`](./testing-implementation-guide.md) を参照してください。本ドキュメントは「動かし方と CI 化」のみ扱います。

### 1.2 バックエンド

```bash
# Unit テスト (services のロジックを対象。すべてモック駆動なので DB 不要)
cd backend
npm test
```

10 本程度のテストが 1 秒以内で終わります。**普段の開発中はこれだけ走らせれば十分**です。

```bash
# Watch モード (ファイル保存ごとに再実行)
cd backend
npm run test:watch
```

```bash
# Integration + E2E (実 DB を使うため事前準備が必要)
# リポジトリルートで mysql-test を起動 (初回 / 停止後のみ)
docker compose up -d mysql-test

# backend ディレクトリでテストを実行
cd backend
npm run test:integration
```

- `mysql-test` は `docker-compose.yml` で定義された **ポート 3307**、**DB 名 `app_test`** のテスト専用 MySQL コンテナ
- 本番用 `mysql` (ポート 3306) とは別コンテナなのでデータ汚染は起こらない
- テスト前に `global-setup.ts` がスキーマを再構築し、各テストの `beforeEach` で `cleanupDb()` がテーブルを空にする
- 詳細は [`testing-implementation-guide.md §3`](./testing-implementation-guide.md#3-テストの実行方法) 参照

### 1.3 フロントエンド

```bash
cd frontend
npm test
```

`jsdom` 環境で 14 本のテストが 2〜3 秒で終わります。**`apiClient` と `authClient` をすべてモックするので、バックエンドサーバーも DB も起動不要**です。

```bash
cd frontend
npm run test:watch
```

### 1.4 「初めて触る人の 1 ターミナル手順」

ローカル環境で **全テストを一気通しに走らせる**最短手順:

```bash
# 1. リポジトリルートで mysql-test を起動
docker compose up -d mysql-test

# 2. バックエンドの全テスト (Unit + Integration + E2E)
(cd backend && npm test && npm run test:integration)

# 3. フロントエンドのテスト
(cd frontend && npm test)
```

合計 10〜15 秒で完結。CI が無くてもこのコマンドを PR 前に手で叩く運用でも当面は回ります (§7 の段階的導入計画の Step 0 がこれ)。

---

## 2. CI/CD への組み込み: 設計の原則

### 2.1 結論 (先出し)

- **PR 時**: Unit + フロントを **必ず**走らせる (高速、DB 不要、落としても影響が局所的)
- **main マージ後 (push)**: 上記に加え Integration / E2E も走らせる (DB が必要、5〜10 秒余分にかかる)
- **デプロイ workflow** (`deploy-ecr-backend-lambda.yml` / `s3-deploy-frontend.yml` 等): **テストを追加しない** (理由は §5)
- 新規追加するファイルは **`.github/workflows/test.yml` 1 つだけ** で済む

### 2.2 「テストとデプロイは分ける」の根拠

[`react-hono-testing-faq.md §5.5`](./react-hono-testing-faq.md#55-やらない方が良いこと) で既に **「テストをビルドフックに入れない」** という結論が示されています。同じ理屈が CI レイヤーでも成立します。

| 観点 | テストとデプロイを混ぜると | 分離すると |
|------|----------------------|---------|
| ゲート位置 | デプロイ実行時に初めてテストが走る → 遅い | PR 作成時にテスト → マージ前に異常を検知 |
| 失敗時の切り分け | 「ビルドが落ちた」のかテストが落ちたのか追いづらい | workflow ファイルが別なので一目瞭然 |
| デプロイの単純さ | テストのため DB セットアップが必要になり、デプロイ workflow が肥大化 | デプロイは「ビルド + push」だけに収まる |
| 緊急デプロイ | テストが落ちていると緊急パッチも出せない | テストとは独立に手動デプロイできる (§5.3) |

### 2.3 PR トリガー / main マージ後 / 手動の 3 軸

| トリガー | 何を走らせるか | 所要時間目安 | 想定 |
|---------|------------|-----------|------|
| `on: pull_request` | Unit (back) + フロント | 1〜2 分 | レビュー前に常時 |
| `on: push (branches: [main])` | 上記 + Integration / E2E | 3〜5 分 | マージ後の最終ガード |
| `on: workflow_dispatch` (既存維持) | ECR / S3 / Lambda デプロイ | 3〜5 分 | リリース時に手動 |

**ポイント**: テスト workflow が PR と push で「走らせる範囲を切り替える」設計にする。これにより、レビュー時の体感速度を保ちつつ、main では DB を絡めた重いテストも回せる。

---

## 3. 推奨するワークフロー構成

### 3.1 全体図

```
PR 作成 / 更新
    │
    ▼
test.yml (新規) — backend-unit + frontend のみ走る
    │ ✓ 通過
    ▼
レビュー → マージ
    │
    ▼
push main
    │
    ▼
test.yml — 上記 + backend-integration も走る
    │ ✓ 通過 (失敗してもデプロイはブロックされない)
    │
    ▼ (任意のタイミングで)
手動で deploy-ecr-backend-lambda.yml / s3-deploy-frontend.yml を実行
    │
    ▼
本番反映
```

### 3.2 PR と main で走らせる範囲の使い分け

| カテゴリ | PR 時 | main push 時 | 理由 |
|---------|-----|-----------|------|
| Backend Unit | ✓ | ✓ | DB 不要・1 秒以内。常時走らせない理由がない |
| Frontend (Unit + Component) | ✓ | ✓ | DB 不要・2〜3 秒。同上 |
| Backend Integration / E2E | — | ✓ | mysql コンテナ起動が必要 (10〜30 秒のオーバーヘッド)。PR 数十本/日になると無視できないので main に寄せる |
| 型チェック (`tsc --noEmit`) | ✓ | ✓ | 既に `npm run build:lambda` の中で走るが、別 job で前段ガードしておくと PR で早く気づける |
| Lint (将来) | ✓ | ✓ | 現状 ESLint 設定はあるがスクリプト未配線。導入時に同じ workflow に job 追加 |

### 3.3 デプロイ workflow には変更を加えない

PR の段階でテストが通っているなら、main に入った後のデプロイで再度走らせる意味は薄いです。
**現状の `deploy-ecr-backend-lambda.yml` / `s3-deploy-frontend.yml` 等は触らない** ── これが推奨。

---

## 4. 推奨ワークフローの具体例

### 4.1 `.github/workflows/test.yml` (新規作成案)

以下を `.github/workflows/test.yml` として追加すれば、§2.1 の方針が実現します。コピペで動く想定:

```yaml
name: test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend-unit:
    name: Backend Unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - name: Install
        working-directory: backend
        run: npm ci
      - name: Run unit tests
        working-directory: backend
        run: npm test

  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - name: Install
        working-directory: frontend
        run: npm ci
      - name: Run tests
        working-directory: frontend
        run: npm test

  backend-integration:
    name: Backend Integration + E2E
    runs-on: ubuntu-latest
    # PR では走らせず、main への push 時のみ実行
    if: github.event_name == 'push'
    services:
      mysql:
        image: mysql:8.0
        ports:
          - 3307:3306
        env:
          MYSQL_ROOT_PASSWORD: password
          MYSQL_DATABASE: app_test
          MYSQL_USER: user
          MYSQL_PASSWORD: password
        options: >-
          --health-cmd="mysqladmin ping -h localhost -ppassword"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - name: Install
        working-directory: backend
        run: npm ci
      - name: Run integration + e2e tests
        working-directory: backend
        run: npm run test:integration
```

#### 設計上のポイント

| 項目 | 値 | 理由 |
|------|-----|------|
| `node-version` | `'22'` | バックエンドの Lambda 本番ランタイム (`public.ecr.aws/lambda/nodejs:22`) と揃える |
| `cache: 'npm'` | 有効 | `package-lock.json` のハッシュをキーに `node_modules` をキャッシュ。1 回目以降 `npm ci` が数秒で終わる |
| `services.mysql` | `mysql:8.0` | `docker-compose.yml` の `mysql-test` と同じイメージ |
| `ports: 3307:3306` | コンテナの 3306 をホスト 3307 にマップ | `backend/vitest.integration.config.ts` が `DATABASE_PORT: '3307'` を期待しているため、ローカルと CI で同じ設定が使える |
| `MYSQL_DATABASE: app_test` | 固定 | 同上 (`DATABASE_NAME: 'app_test'`) |
| `if: github.event_name == 'push'` | integration job のみ | PR では実行しない。main マージ後の push でだけ走る |
| `options: --health-cmd ...` | mysql の `ping` をヘルスチェック | `services` が healthy になるまで `actions/checkout` 以降のステップが待つ |

#### 想定動作

- PR 作成 → `backend-unit` と `frontend` の 2 job だけが走る (1〜2 分)
- main にマージ (= push) → 3 job 全部走る (3〜5 分)
- 失敗時は GitHub の Required check で PR マージをブロック可能 (§6.1)

### 4.2 型チェックと lint を足す場合

将来、PR で型チェックも走らせたい場合は `backend-unit` / `frontend` 各 job の最後に以下を追加:

```yaml
      - name: Type check (backend)
        working-directory: backend
        run: npm run build:lambda  # tsc --noEmit + esbuild が走る

      - name: Type check (frontend)
        working-directory: frontend
        run: npx tsc -b --noEmit
```

ESLint を全面導入したら同じ位置に `npm run lint` を追加。

---

## 5. デプロイ workflow にテストを足さないほうが良い理由

### 5.1 結論

以下の既存 workflow には **テスト実行ステップを追加しない**:

- `.github/workflows/deploy-ecr-backend-lambda.yml`
- `.github/workflows/s3-deploy-frontend.yml`
- `.github/workflows/update-lambda.yml`
- `.github/workflows/invoke-db-task.yml`
- `.github/workflows/terraform-apply-plan.yml`
- `.github/workflows/terraform-stg-destroy.yml`

これらは **現状のまま (テスト無し / workflow_dispatch トリガー)** を維持します。

### 5.2 3 つの理由

#### 1. 責務分離

デプロイ workflow は「ビルド + push のみ」に保ち、失敗時に「何が落ちたか」を 1 秒で判別できる状態を保つ。テストを混ぜると、

- 「テストが落ちたのか、ECR push が失敗したのか」を切り分ける手間が増える
- 失敗ログが長くなり、原因特定に時間がかかる

#### 2. 重複実行のコスト

PR / main push の時点でテスト workflow が走っているなら、デプロイ時に同じテストを再実行する価値は薄い。

- main にマージされたコード = テストが通った前提
- それを再実行するのは時間と GitHub Actions の利用枠 (Free プランの 2,000 分/月) の浪費

#### 3. デプロイの単純さを守る

Integration テストを `deploy-ecr-backend-lambda.yml` に足すと、デプロイ前提として MySQL コンテナの起動が必要になる。

- 「本番デプロイのために mysql を立てる」のはどう見ても倒錯
- デプロイ workflow を最小・冪等に保つ方針と矛盾

### 5.3 例外: 緊急デプロイの逃げ道

「PR テストを通さずに緊急デプロイしたい」ケースのために、現状の `workflow_dispatch` (手動実行) は **そのまま温存します**。

- テストの workflow と独立しているので、テストが赤くてもデプロイ workflow は実行可能
- ただし「テストを通さない緊急デプロイ」は責任を取れる人が手動で判断する運用にする
- 平時はテスト workflow → main マージ → 手動デプロイの順を守る

---

## 6. よくある質問

### 6.1 PR テストを必須化 (Required check) するべきか?

**推奨**: PR の `backend-unit` と `frontend` は **Required check に設定する**。

GitHub の Settings → Branches → Branch protection rules で `main` に対して:
- "Require status checks to pass before merging" を ON
- `backend-unit` / `frontend` を追加

`backend-integration` は PR では走らないので Required にしない (= main 限定の "事後監視" 扱い)。

### 6.2 Vitest のキャッシュは CI で効くのか?

- `actions/setup-node` の `cache: 'npm'` で **`node_modules` のキャッシュは効く**。2 回目以降の `npm ci` が数秒で済む
- Vitest 自体には `.vitest-cache` のようなテスト結果キャッシュは無いので、テスト実行時間は毎回フルで掛かる (= 期待しない)

### 6.3 mysql-test を CI ではどう立てる?

`docker-compose up` ではなく、GitHub Actions の `services:` ブロックを使う (§4.1 参照)。両者は等価:

| 観点 | ローカル | CI |
|------|--------|-----|
| 実体 | `docker-compose.yml` の `mysql-test` サービス | `services.mysql` ブロック |
| 起動 | `docker compose up -d mysql-test` | `services:` の自動起動 |
| ホスト | 127.0.0.1 | 127.0.0.1 |
| ポート | 3307 | 3307 (`ports: 3307:3306`) |
| DB 名 | app_test | app_test (`MYSQL_DATABASE`) |

両者で `backend/vitest.integration.config.ts` の env 設定がそのまま使えるため、テスト側のコードを変更する必要がない。

### 6.4 テストコードを本番 Docker image に含めないようにするには?

本ドキュメントの範囲外。`.dockerignore` や `tsconfig.json` の `exclude` を使う方法が [`react-hono-testing-faq.md §5`](./react-hono-testing-faq.md#5-テストコードは-dockerci-のビルドに含めないようにすべき) に詳述されています。

### 6.5 テスト workflow が落ちている間 main にマージできなくしたい

§6.1 の Branch protection rules で実現できます。Required check に追加した job が赤いと、PR の "Merge" ボタンがグレーアウトします。

### 6.6 Integration テストが CI で flaky になったら?

- まず GitHub Actions のログで `services.mysql` の healthy 待ちが間に合っているか確認
- `health-retries: 10` → `20` に増やすか、`global-setup.ts` のリトライ回数を上げる
- それでも頻発するなら、Integration を PR で走らせる方針を見直し、`workflow_dispatch` で手動実行に倒すのも選択肢

---

## 7. 段階的な導入計画

最初から完璧な CI を目指さず、以下の順序で積み上げます。

1. **Step 0 (現状)**: ローカルで `§1.4` の 1 ターミナル手順を運用ルール化
2. **Step 1**: `.github/workflows/test.yml` を `§4.1` の内容で追加 (PR トリガーのみ → integration job はまだ追加しない)
3. **Step 2**: 数本の PR で workflow が安定するか確認 (赤くなる頻度を見る)
4. **Step 3**: GitHub の Branch protection rules で `backend-unit` / `frontend` を Required に設定
5. **Step 4**: `backend-integration` job を `test.yml` に追加 (= `§4.1` の完全版に到達)
6. **Step 5**: main push 後の Integration が赤くなる頻度を見て、その結果を Slack 通知 / Issue 化する仕組みを追加検討
7. **Step 6**: lint / Visual Regression / Playwright E2E を追加するときも、同じ `test.yml` に job を追加していく (新規 workflow ファイルは作らない)

「最初は薄く、痛みが出た部分から厚くする」のはテスト戦略 ([`backend-testing-strategy.md §11`](./backend-testing-strategy.md#11-何から始めるか)) と同じ思想です。

---

## 関連ドキュメント

- [`testing-implementation-guide.md`](./testing-implementation-guide.md) §3 — ローカル実行コマンドの詳細と背景
- [`react-hono-testing-faq.md`](./react-hono-testing-faq.md) §5 — テストコードを本番ビルドに含めない話 (`.dockerignore` 例つき)
- [`backend-testing-strategy.md`](./backend-testing-strategy.md) / [`frontend-testing-strategy.md`](./frontend-testing-strategy.md) — 何をテストすべきかの戦略
- [`../github-actions-iam-roles-guide.md`](../github-actions-iam-roles-guide.md) — デプロイ系 workflow の OIDC / IAM 設定 (本 workflow は AWS 認証不要)
