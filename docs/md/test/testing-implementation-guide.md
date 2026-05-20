# テスト実装ガイド (Vitest + Testing Library 編)

このドキュメントは、本リポジトリに導入したテストコードの **実装記録 + リファレンス** です。

- 「なぜテストを分けるのか」「どの粒度に何を書くか」 → [`backend-testing-strategy.md`](./backend-testing-strategy.md) (戦略)
- 「実際にどう書いたか」「どう実行するか」「ファイルの役割は何か」 → **このドキュメント**

戦略を読んでから本ドキュメントへ進むと、コードの意図を追いやすくなります。

---

## 1. 全体像

### 1.1 構成と本数

| 種別 | 場所 | 本数 | 外部依存の扱い |
|------|------|------|---------------|
| バックエンド Unit | `backend/src/services/__tests__/` | 10 | すべてモック |
| バックエンド Integration | `backend/src/__tests__/integration/` | 6 | DB は実物 (mysql-test) / AWS はモック / 認証はモック |
| バックエンド E2E | `backend/src/__tests__/e2e/` | 1 | DB は実物 / AWS はモック / 認証はモック |
| フロントエンド Unit / Component | `frontend/src/{lib,hooks,components}/__tests__/` | 14 | fetch / authClient / apiClient をモック |
| **合計** | | **31** | |

戦略ドキュメント 2 章のピラミッド (Unit が広く、E2E は最小) を踏襲しています。

### 1.2 ディレクトリツリー (テスト関連のみ抜粋)

```
react-hono-practice/
├── backend/
│   ├── vitest.config.ts                       # Unit 用設定
│   ├── vitest.integration.config.ts           # Integration / E2E 用設定
│   └── src/
│       ├── services/
│       │   ├── qrcode.service.ts              # (テスト対象)
│       │   ├── storage.service.ts             # (テスト対象)
│       │   ├── mail.service.ts                # (テスト対象)
│       │   └── __tests__/
│       │       ├── qrcode.service.test.ts
│       │       ├── storage.service.test.ts
│       │       └── mail.service.test.ts
│       └── __tests__/
│           ├── global-setup.ts                # 起動待ち + schema 投入
│           ├── helpers/
│           │   ├── schema.sql                 # テスト用 DB の DDL
│           │   ├── db.ts                      # cleanupDb()
│           │   └── auth.ts                    # 認証モックヘルパー
│           ├── integration/
│           │   └── qrcodes.route.test.ts
│           └── e2e/
│               └── qrcode-flow.test.ts
├── frontend/
│   ├── vitest.config.ts                       # vite.config.ts とは別
│   └── src/
│       ├── test/setup.ts                      # jest-dom + cleanup
│       ├── lib/__tests__/api.test.ts
│       ├── hooks/__tests__/useAuth.test.tsx
│       └── components/__tests__/QrCodeGenerator.test.tsx
└── docker-compose.yml                          # mysql-test サービス追加
```

---

## 2. 使っているツールと役割

### Vitest

テストランナー本体。`describe / it / expect / vi` といったテスト記法と、TypeScript / ESM のネイティブサポート、ファイル監視 (`--watch`) を提供します。Jest と API 互換ですが、Vite と同じトランスパイラ (esbuild) を使うため起動が速く、`vi.mock` も巻き上げ動作が分かりやすいのが特徴です。

選定理由: 本プロジェクトのバックエンドは esbuild + ESM、フロントエンドは Vite。`tsx` / `vite` のトランスパイル設定を流用できる Vitest が最も摩擦が少なく、設定ファイルも 1〜2 行で済みました。

### @testing-library/react

React コンポーネントを「ユーザー視点で」テストするためのライブラリ。`screen.getByLabelText`、`screen.findByText` などのクエリは「画面に見える要素」をベースに DOM を探します。実装詳細 (state や props) ではなく**振る舞い**を検証する設計思想です。

選定理由: React 公式ドキュメントが推奨しており、React 19 にも追従しています。`enzyme` などの旧来手法はメンテナンスされていません。

### @testing-library/user-event

`fireEvent` (合成イベント直送) より一段現実に近い「ユーザー操作」シミュレータ。`await user.type(...)` は各文字を個別の `keydown / keypress / input / keyup` として発火するため、`onChange` のロジックや IME 関連の挙動も近い形で再現できます。

### @testing-library/jest-dom

`expect(element).toBeInTheDocument()` や `.toBeDisabled()` のような **DOM 専用マッチャ** を追加します。生の `expect(el !== null)` よりも失敗メッセージが読みやすく、Testing Library とセットで使うのが慣例です。

### jsdom

Node.js 上で動く軽量ブラウザ実装 (DOM API)。ブラウザを起動せずに `document` / `window` を使えるようにします。Vitest は `test.environment: 'jsdom'` を設定するだけで取り込めます。

### aws-sdk-client-mock

AWS SDK v3 クライアントを「クラスごと」差し替えるモックライブラリ。`mockClient(S3Client).on(PutObjectCommand).resolves({})` のように、コマンド単位で挙動を制御できます。Unit / Integration / E2E のすべてで S3 を本物には触らせません。

選定理由: AWS SDK v3 では各サービス (`@aws-sdk/client-s3` 等) が独立パッケージ化されており、`jest.mock` / `vi.mock` で個別にやるとボイラープレートが膨らみます。本ライブラリはこの事情に特化した事実上のデファクトです。

### Hono `app.request()`

Hono アプリは `app.request(url, init?)` で **HTTP サーバーを起動せずに** ルーターを直接呼べます。戻り値は標準 `Response`。supertest などの追加ライブラリが不要で、テストが軽量になります。

選定理由: Hono 公式テストガイドの標準パターン。本プロジェクトでは Integration / E2E の両方でこれを使います。

### mysql2 + Docker Compose

Integration / E2E では戦略ドキュメント 9.6 の方針に従い「実 DB」を使います。本番用 MySQL とは別コンテナ (`mysql-test`、ポート 3307、DB 名 `app_test`) を立て、テスト時のみ利用します。

選定理由: Drizzle ORM の SQL 発行ミスや、`$onUpdate(() => new Date())` のような ORM 固有挙動はモックでは捕捉できないため。

---

## 3. テストの実行方法

### バックエンド (Unit のみ)

```bash
cd backend
npm test
```

実 DB 不要。10 本のテストが 1 秒以内で終わります。普段の開発中はこちらだけ走らせれば十分です。

`npm run test:watch` でファイル監視モードに入ります。

### バックエンド (Integration + E2E)

```bash
# 1. テスト用 MySQL を起動 (初回 / コンテナ未起動時のみ)
docker compose up -d mysql-test

# 2. Integration + E2E を実行
cd backend
npm run test:integration
```

`globalSetup` がコンテナの healthy 状態を待ち、`helpers/schema.sql` でスキーマを毎回再構築します。各テストの `beforeEach` で `cleanupDb()` が走るので、テスト間のデータ汚染は起こりません。

### フロントエンド

```bash
cd frontend
npm test
```

jsdom 環境で 14 本のテストが 2 秒程度で終わります。実 DB やバックエンドサーバーは不要 (`apiClient` ごとモックするため)。

### よくあるハマりどころ

- **`mysql-test` が起動していない** → `npm run test:integration` がタイムアウト前に失敗。`docker compose up -d mysql-test` を先に
- **`mysql-test` が `mysql` (本番側) と DB データを混同しないか** → 別コンテナ・別ポート・別 DB 名で完全に分離されているので心配なし
- **テスト後に Node プロセスが終わらない** → 各テストファイルの `afterAll` で `pool.end()` を呼び切れているか確認

---

## 4. 作成したファイル一覧と役割

### 4.1 バックエンド

| パス | 役割 |
|------|------|
| `backend/vitest.config.ts` | Unit 用設定。`src/**/*.test.ts` を対象に、`__tests__/integration` `__tests__/e2e` を除外 |
| `backend/vitest.integration.config.ts` | Integration / E2E 用設定。`pool: forks` + `singleFork: true` で直列実行、`env` でテスト DB を指定 |
| `backend/src/__tests__/global-setup.ts` | `mysql-test` の起動待ち → `schema.sql` を実行してスキーマ初期化 |
| `backend/src/__tests__/helpers/schema.sql` | テスト用 DB の DDL。`src/db/schema.ts` と同じ構造を SQL で再現 |
| `backend/src/__tests__/helpers/db.ts` | `cleanupDb()` — 外部キーを考慮して子→親の順で全テーブル削除 |
| `backend/src/__tests__/helpers/auth.ts` | `createAuthMock()` / `setSessionUser()` / `clearSession()` — `config/auth` モジュールを差し替えて任意ユーザーで認証状態を作る |
| `backend/src/services/__tests__/qrcode.service.test.ts` | `generateAndUpload()` を `qrcode` ライブラリと `storage.service` をモックして検証 (3 本) |
| `backend/src/services/__tests__/storage.service.test.ts` | `uploadFile()` / `getFileUrl()` を `aws-sdk-client-mock` で S3 を差し替えて検証 (4 本) |
| `backend/src/services/__tests__/mail.service.test.ts` | `sendMail()` を `config/mail` モックで検証。HTML テンプレート出力も確認 (3 本) |
| `backend/src/__tests__/integration/qrcodes.route.test.ts` | `/api/qrcodes` ルートを `app.request()` で実 DB に対して叩く。正常 / 異常系を 6 本 |
| `backend/src/__tests__/e2e/qrcode-flow.test.ts` | POST → GET の主要フローをハッピーパス 1 本で通す |

### 4.2 フロントエンド

| パス | 役割 |
|------|------|
| `frontend/vitest.config.ts` | Vitest 専用設定 (`vite.config.ts` とは別ファイル)。jsdom + jest-dom 拡張 |
| `frontend/src/test/setup.ts` | `@testing-library/jest-dom/vitest` を取り込み、`afterEach` で `cleanup()` を呼ぶ |
| `frontend/src/lib/__tests__/api.test.ts` | `apiClient.get/post` のパラメータ組み立て、401 リダイレクト動作を検証 (6 本) |
| `frontend/src/hooks/__tests__/useAuth.test.tsx` | `useAuth` フックの Provider 外エラー、セッション読み込み挙動を検証 (4 本) |
| `frontend/src/components/__tests__/QrCodeGenerator.test.tsx` | `QrCodeGenerator` コンポーネントのフォーム送信・エラー表示・カスタムイベント発火を検証 (4 本) |

### 4.3 設定変更

| パス | 変更内容 |
|------|---------|
| `backend/package.json` | `vitest` / `@vitest/coverage-v8` / `aws-sdk-client-mock` を devDeps に追加。`test` / `test:watch` / `test:integration` スクリプト追加 |
| `frontend/package.json` | `vitest` / `@testing-library/{react,user-event,jest-dom}` / `jsdom` を devDeps に追加。`test` / `test:watch` スクリプト追加 |
| `docker-compose.yml` | `mysql-test` サービス追加 (ポート 3307、DB 名 `app_test`、ボリュームなし=揮発) |

---

## 5. テスト種別ごとの書き方 (実例)

### 5.1 Unit: `vi.mock` でモジュールを差し替える

`backend/src/services/__tests__/qrcode.service.test.ts` の冒頭:

```ts
vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn<(data: string, options?: object) => Promise<Buffer>>(),
  },
}));

vi.mock('../storage.service', () => ({
  uploadFile: vi.fn(),
}));

import QRCode from 'qrcode';
import { uploadFile } from '../storage.service';
import { generateAndUpload } from '../qrcode.service';
```

**ポイント**:
- `vi.mock` は import 文より上に書いても OK (Vitest が自動で巻き上げる)
- `default` キーは ESM の default export を表す。`import QRCode from 'qrcode'` を差し替えるなら必須
- `vi.fn<(args) => Promise<Buffer>>()` で戻り型を明示すると、`mockResolvedValue` の型推論が安定する (QRCode のような overload が多い API で重要)

検証例:

```ts
it('uploadFile に toBuffer の戻り値 (Buffer) と image/png が渡される', async () => {
  const buf = Buffer.from('mock-buffer-contents');
  mockedToBuffer.mockResolvedValue(buf);

  const fileName = await generateAndUpload('data', 1);

  expect(mockedUploadFile).toHaveBeenCalledWith(fileName, buf, 'image/png');
});
```

引数を `toHaveBeenCalledWith` で確認することで、**何をどう呼んでいるか** を assert します。戦略ドキュメント 7 章の「モックしすぎたテスト」になっていないか、ここで意識します。

### 5.2 Unit: `aws-sdk-client-mock` で AWS SDK を差し替える

`backend/src/services/__tests__/storage.service.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

beforeEach(() => s3Mock.reset());

it('正常系: PutObjectCommand を期待した引数で S3 に送信する', async () => {
  s3Mock.on(PutObjectCommand).resolves({});

  await uploadFile('user-1/image.png', Buffer.from('hello-png'), 'image/png');

  const calls = s3Mock.commandCalls(PutObjectCommand);
  expect(calls).toHaveLength(1);
  expect(calls[0].args[0].input).toEqual({
    Bucket: env.S3_BUCKET,
    Key: 'user-1/image.png',
    Body: expect.any(Buffer),
    ContentType: 'image/png',
  });
});
```

**ポイント**:
- `mockClient(S3Client)` で **S3Client クラスのインスタンス全体** を乗っ取る。`storage.service.ts` の `s3Client` を直接いじる必要がない
- `s3Mock.on(PutObjectCommand).resolves({})` でコマンドごとに戻り値を設定
- `s3Mock.commandCalls(...)` で「どんな引数で何回呼ばれたか」を後から検査できる

### 5.3 Integration: 実 DB + Hono ルーター

`backend/src/__tests__/integration/qrcodes.route.test.ts`:

```ts
// 認証ミドルウェアが呼ぶ getAuth() を差し替え (vi.mock は app.ts より上に書く)
vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db, pool } from '../../config/database';

beforeEach(async () => {
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  await cleanupDb();
  clearSession();
});

afterAll(async () => {
  await pool?.end();   // これを忘れると Node プロセスが hang する
});

it('正常系: 201 を返し、DB に 1 件作成され、S3 にアップロードされる', async () => {
  setSessionUser(TEST_USER);
  await insertTestUser();

  const res = await app.request('/api/qrcodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'hello world' }),
  });

  expect(res.status).toBe(201);

  const stored = await db.select().from(qrCodes);
  expect(stored).toHaveLength(1);
  expect(stored[0].data).toBe('hello world');

  expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
});
```

**ポイント**:
- `app.request()` は実 HTTP サーバー不要。`Request` を受け取って `Response` を返すただの関数として呼べる
- `db.select().from(qrCodes)` で **実 DB の状態** を直接検査できるのが Integration の強み (戦略 9.4 の「実 DB に書き込まれた結果を assert する」)
- 認証は `helpers/auth.ts` の `setSessionUser` で切り替え可能。`clearSession()` で未ログイン状態にして 401 も検証

### 5.4 E2E: 複数 API を続けて叩く

`backend/src/__tests__/e2e/qrcode-flow.test.ts`:

```ts
it('ハッピーパス: POST /api/qrcodes → GET /api/qrcodes で作成済み QR が含まれる', async () => {
  const created = await app.request('/api/qrcodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'https://example.com' }),
  });
  expect(created.status).toBe(201);

  const listed = await app.request('/api/qrcodes');
  expect(listed.status).toBe(200);

  const body = await listed.json();
  expect(body.qrcodes).toHaveLength(1);
  expect(body.qrcodes[0].data).toBe('https://example.com');
  expect(body.qrcodes[0].user.name).toBe(TEST_USER.name);
});
```

**ポイント**:
- 戦略 9.5 の通り「主要フローの **ハッピーパス 1 本**」に絞っている (エラー網羅は Unit/Integration の仕事)
- 認証セッションは 1 回作れば続く HTTP 呼び出しでも使える (`beforeEach` で `setSessionUser` 済み)
- ここで route のレスポンス形 (`user.name` などのキー) が変わると壊れるので、**API 仕様の契約テスト** としても機能する

### 5.5 Frontend Unit: `apiClient` を fetch モックで

`frontend/src/lib/__tests__/api.test.ts`:

```ts
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true, writable: true,
    value: { pathname: '/', href: '/' },
  });
  vi.stubGlobal('fetch', vi.fn());
});

it('異常系: /login 以外で 401 を受け取ったら /login にリダイレクトする', async () => {
  (window.location as { pathname: string }).pathname = '/dashboard';
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false, status: 401, json: async () => ({}),
  });

  await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);
  expect(window.location.href).toBe('/login');
});
```

**ポイント**:
- jsdom の `window.location` は通常 read-only。`Object.defineProperty` で完全に置き換える
- `vi.stubGlobal('fetch', vi.fn())` で `globalThis.fetch` を差し替え。`afterEach` の `vi.unstubAllGlobals()` で元に戻す
- 401 で `/login` に飛ぶ挙動 (`apiClient` 内のルール) を直接 assert できる

### 5.6 Frontend Hook: `renderHook` + `wrapper`

`frontend/src/hooks/__tests__/useAuth.test.tsx`:

```ts
vi.mock('../../lib/auth-client', () => ({
  authClient: { getSession: vi.fn(), signOut: vi.fn() },
}));

it('正常系: セッションがあれば User オブジェクトを返す', async () => {
  mockedGetSession.mockResolvedValue({
    data: { user: { id: '42', name: 'Alice', email: 'a@example.com', image: null } },
  } as never);

  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

  await waitFor(() => expect(result.current.isLoading).toBe(false));

  expect(result.current.user).toEqual({
    id: 42, name: 'Alice', email: 'a@example.com', avatar_url: null,
  });
});
```

**ポイント**:
- `renderHook` でフックを Provider 配下に置いた状態で実行できる
- `useEffect` 内で非同期処理が走るため、`waitFor` で `isLoading` が `false` になるまで待つ
- Provider の外でフックを呼ぶケースは `expect(...).toThrow(...)` で検証 (戦略 4.1 の「異常系テスト」の典型形)

### 5.7 Frontend Component: `userEvent` でユーザー操作を再現

`frontend/src/components/__tests__/QrCodeGenerator.test.tsx`:

```ts
vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

it('正常系: テキスト入力 → 送信で apiClient.post が呼ばれ成功メッセージが表示される', async () => {
  mockedPost.mockResolvedValue({ data: { id: 1 }, status: 201, ok: true });
  const user = userEvent.setup();

  render(<QrCodeGenerator />);
  await user.type(screen.getByLabelText(/QRコードに含めるデータ/), 'https://example.com');
  await user.click(screen.getByRole('button', { name: /QRコードを生成/ }));

  expect(mockedPost).toHaveBeenCalledWith('/qrcodes', { data: 'https://example.com' });
  expect(await screen.findByText('QRコードを生成しました')).toBeInTheDocument();
});
```

**ポイント**:
- `userEvent.setup()` を `it` ごとに呼んでイベントの状態を分離
- `screen.getByLabelText` は `<label htmlFor>` を辿ってフォーム要素を取得。`<label>` を書く動機にもなる
- `findByText` は非同期で要素が現れるまで待つ (`waitFor` + `getByText` の糖衣)
- `apiClient` をモックすることで「HTTP 通信を気にせず UI ロジックだけ検証する」設計を実現

---

## 6. このスタックは React + Hono で標準的か?

| ツール | 標準度 | 補足 |
|--------|--------|------|
| Vitest | ◎ デファクト | Vite を使うプロジェクトでは Jest を置き換える流れが定着。Hono / Drizzle 公式サンプルでも採用 |
| @testing-library/react | ◎ 公式推奨 | React 公式ドキュメント (Testing Recipes) で唯一推奨されているテストライブラリ |
| @testing-library/user-event | ○ 慣例 | testing-library の姉妹パッケージ。`fireEvent` より一段現実的なため近年は user-event が主流 |
| @testing-library/jest-dom | ○ 慣例 | testing-library 公式の DOM マッチャ集。なくても書けるが、入れない理由がない |
| jsdom | ○ デフォルト | Vitest の DOM 環境は jsdom か happy-dom。jsdom は仕様準拠で堅実 |
| aws-sdk-client-mock | ◎ 事実上唯一の選択肢 | AWS SDK v3 (現行) をモックする標準。SDK v2 時代の `aws-sdk-mock` の後継 |
| Hono `app.request()` | ◎ 公式推奨 | Hono 公式テストガイドの第一選択。`supertest` 不要 |
| `mysql2` で実 DB 接続 | ○ 慣例 | Drizzle ORM 公式サンプルも同じ形 (`mysql2` ドライバ) |
| Docker Compose 別コンテナの test DB | ○ 業界共通 | Laravel の `phpunit.xml` で別 DB を指す手法と同思想 |

**結論**: 2026 年時点で「Vite + React + Hono + Drizzle + AWS SDK v3」を使うなら、このスタックは**最も摩擦が少なく標準的**な組み合わせです。`Cypress` / `Playwright` での E2E (ブラウザ起動版) を別途乗せるプロジェクトもありますが、本プロジェクトの規模では `app.request()` ベースの E2E で十分です。

---

## 7. 新しいテストを追加するときのチェックリスト

1. **粒度の判断** — 戦略ドキュメント [8.3 章](./backend-testing-strategy.md) の「これは書く / これは書かなくていい」を確認
2. **置き場所** —
   - Unit: 対象ファイルの隣に `__tests__/対象名.test.ts`
   - Integration: `backend/src/__tests__/integration/`
   - E2E: `backend/src/__tests__/e2e/`
   - Frontend: 対象ファイルの隣に `__tests__/対象名.test.tsx`
3. **モック対象** —
   - DB は実物 (Integration / E2E)、それ以外の場面ではモック
   - S3 / SQS / SES は常にモック (`aws-sdk-client-mock`)
   - 自プロジェクト内の関数は基本モックしない (戦略 7 章)
4. **後片付け** —
   - DB を触ったら `beforeEach(cleanupDb)`
   - グローバル状態を書き換えたら `afterEach` で復元
   - `mysql.Pool` を使ったら `afterAll(() => pool.end())`
5. **実行** —
   - Unit のみなら `npm test`
   - DB を使うなら `docker compose up -d mysql-test && npm run test:integration`

---

## 8. つまずきポイントと対処

実装中に実際にぶつかった問題のメモ。同じところで詰まる人向け。

### 8.1 Vite 7 + Vitest 2 で `vite.config.ts` に `test` を入れると型衝突

**症状**: `vite.config.ts` に `test: { ... }` を足すと、`@vitejs/plugin-react` の `Plugin` 型と Vitest が抱える Vite 5 の `Plugin` 型がぶつかって tsc がコケる。

**対処**: `vite.config.ts` と `vitest.config.ts` を別ファイルに分離。Vitest は `vitest.config.ts` を自動で優先するので、設定はそちらに置く。tsconfig.node.json の `include` が `vite.config.ts` だけなら `vitest.config.ts` は tsc の検査対象に入らず、実行時は esbuild で型は剥がれるので問題なく動く。

### 8.2 `QRCode.toBuffer` の overload で `vi.mocked` の型推論がズレる

**症状**: `mockedToBuffer.mockResolvedValue(Buffer.from(''))` で `Argument of type 'Buffer' is not assignable to parameter of type 'void'` のエラー。

**理由**: `qrcode` の型定義は `toBuffer(text, callback): void` と `toBuffer(text, options?): Promise<Buffer>` の overload を持つ。`vi.mocked()` は overload を union として捉えるため、callback 版の `void` が選ばれる場合がある。

**対処**: モックの戻り型を明示してキャストする。

```ts
const mockedToBuffer = vi.mocked(QRCode.toBuffer) as unknown as ReturnType<
  typeof vi.fn<(data: string, options?: object) => Promise<Buffer>>
>;
```

### 8.3 `mysql-test` の起動待ち

**症状**: `globalSetup` が初回実行時に `Connection refused` で失敗。

**対処**: `mysql.createConnection({...}).ping()` を 1 秒間隔で最大 60 回ポーリングする (`global-setup.ts`)。Docker のヘルスチェックだけに依存しない。

### 8.4 `pool.end()` を忘れると Node プロセスが hang

**症状**: テストは全部 pass するが、`vitest run` が終わってもプロセスが終了しない。

**理由**: `config/database.ts` で `mysql.createPool` が作るコネクションが開きっぱなし。

**対処**: 各 Integration / E2E テストファイルの `afterAll` で `await pool.end()` を呼ぶ。`pool: 'forks'` + `singleFork: true` で同一プロセスを使い回すので、最後のファイルで閉じれば足りる。

### 8.5 BetterAuth は `config/auth.getAuth()` ごとモックするのが楽

**症状**: `getAuth().api.getSession()` を細かくモックしようとすると、`api` オブジェクトを丸ごと組み立てる必要があって面倒。

**対処**: `vi.mock('../../config/auth', () => createAuthMock())` で **モジュール丸ごと差し替え**。`createAuthMock()` の中でテスト側の `state` を参照する `getSession` を返すことで、テストごとに `setSessionUser` / `clearSession` で挙動を切り替えられる (`helpers/auth.ts`)。

### 8.6 副産物: 一覧 API が `status` を返していなかった

E2E を書いている途中で発見。`backend/src/controllers/qrcodes.controller.ts` の `index` ハンドラがレスポンスマッピングで `status` カラムを返していない。フロントが必要としていないなら問題ないが、戦略 9.5 の「契約テストとして機能する」が早速効いた例。

---

## 関連ドキュメント

- [`backend-testing-strategy.md`](./backend-testing-strategy.md) — テスト粒度の戦略 (本ドキュメントの前提)
- [`drizzle-migration-guide.md`](./drizzle-migration-guide.md) — DB スキーマ管理。`helpers/schema.sql` を更新する際に参照
- [`environment-config.md`](./environment-config.md) — 環境変数の扱い。`.env.test` を将来追加する場合の指針
