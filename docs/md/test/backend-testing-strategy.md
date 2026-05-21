# バックエンドテスト戦略ガイド

このドキュメントは **「テストの書き方」ではなく「テストをどの粒度で分けるか」** を解説するものです。Laravel・Hono・Express など特定のフレームワークに依存しない一般論を先に整理し、後半で本プロジェクト (Hono + Drizzle + MySQL + BetterAuth + AWS) への適用例を示します。

実際のテストコードを書き始める前に、本ドキュメントを読んで「どのレイヤーをどのテスト種別で守るのか」のイメージを持つことを推奨します。

---

## 1. なぜテストを分けるのか

テストには **速さ・壊れにくさ・原因の切り分けやすさ** という相反する性質があり、1 種類のテストだけで全部を満たせません。

| 観点 | 全部を E2E で書くと | 全部を Unit で書くと |
|------|-------------------|-------------------|
| 速度 | 1 本数秒〜十数秒、開発中に回らない | 数百本でも数秒、開発中に常時回せる |
| 壊れやすさ | DB やネットワークの揺らぎで偽陽性 | 安定するが、本物の挙動と乖離しがち |
| 失敗時の原因特定 | 経路が長くて原因がわかりにくい | 失敗箇所がそのままバグ箇所 |
| カバーできる範囲 | 経路全体・本物の挙動 | 個別ロジックのみ、結合バグは取れない |

そこで **粒度の違うテストを組み合わせる** のが定石です。

---

## 2. テストピラミッド

一般的に推奨される構成は「下が広く、上にいくほど少ない」ピラミッド型です。

```
        ▲  少
       ╱E2E╲           ← HTTP リクエストから DB まで通す
      ╱─────╲
     ╱結合 (Integration)╲   ← 複数レイヤーをまたぐ
    ╱──────────────────╲
   ╱  単体 (Unit)         ╲ ← 1 関数 / 1 メソッド
  ╱──────────────────────╲
                          ▼  多
```

数の目安は **Unit : Integration : E2E ≒ 70 : 20 : 10** あたりが目安としてよく挙げられますが、厳密な比率より「下にいくほど速くて多い」という性質を保つことが重要です。

アンチパターン: **アイスクリームコーン型** (E2E ばかり多く、Unit が少ない) は、CI が遅くなり原因切り分けも難しくなるため避けます。

---

## 3. 各レイヤーの責務

### 判断軸: リクエスト数ではなく「どこまでを本物にするか」で分ける

「単体 = 関数 1 個、結合 = DB を介した 1 リクエスト、E2E = 複数リクエストにまたがるテスト」── このイメージは **半分当たり、半分外れ** です。3 種類のテストを分ける本質的な軸は、**リクエストの本数ではなく「どこまでを本物のまま通して、どこをモックで止めるか」** にあります。

3 種類を 1 表で比較すると、線引きはこうなります。

| | スコープ (どこを動かすか) | HTTP | DB | 認証 | 外部 SaaS (S3/SES/SQS) |
|---|------------------|------|----|----|------|
| 単体 (Unit) | 1 関数 / 1 メソッド | 通さない | モック | 不要 / モック | モック |
| 結合 (Integration) | 複数レイヤーをまたぐ動作 | 通しても通さなくてもよい | **本物 (テスト用 DB)** | モック (Cookie 偽装など) | モック |
| E2E (End-to-End) | リクエスト〜レスポンスまでの全経路 | **必ず通す (1 本でも可)** | 本物 (テスト用 DB) | **本物の経路を通す** | モック |

これを踏まえて、よくある 3 つの誤解を 1 つずつほどきます。

- **「単体 = 1 関数のテスト」** ── おおむね正しい。**外部 I/O (DB / HTTP / 時計 / 乱数) をすべてモック**して、関数の入力 → 出力だけを検証するのが単体テスト。「DB に依存していない」というより「**DB に触らせない**」のがポイント。
- **「結合 = DB を介した 1 リクエスト」** ── 近いが厳密ではない。`app.request()` で HTTP を通す結合テストは典型例だが、**HTTP を経由する必要はない**。たとえば *Service 関数を直接呼んで、実 DB に書き込まれた結果を assert する* のも立派な結合テスト。本質は **「複数レイヤーをまたぐ」** ことと **「DB を本物にする」** ことで、HTTP 経由かどうかは定義には含まれない。同様に「1 リクエスト」かどうかも本質ではなく、1 つのテスト内で POST → GET と 2 回叩いても結合テスト足り得る。
- **「E2E = 複数リクエストにまたがるテスト」** ── これは誤解。**1 リクエストだけでも E2E は成立する**。E2E の本質は「リクエスト数」ではなく **「1 本のリクエストを受けてからレスポンスを返すまでの全経路 (ルーター → 認証 → ミドルウェア → コントローラ → サービス → DB) を、本番に近い構成のまま通すかどうか」**。複数リクエストを連鎖させる (例: ログイン → 作成 → 取得) のは「ユーザーが実際にたどる導線」をモデル化したい場合の一形態であって、E2E の定義そのものではない。

なお、**結合テストと E2E テストは外見が似ている**: どちらも実 DB を使い、どちらも `app.request()` で HTTP を叩くことがある。両者の境目は **「認証とミドルウェアスタックを本物のまま通すか」** にある。

- Integration: `setSessionUser(TEST_USER)` のように **認証をショートカット**して、ビジネスロジック部分 (バリデーション、DB 反映、レスポンス形) を狙い撃ちする。
- E2E: BetterAuth のセッション発行やミドルウェア順序込みで、ユーザーが実際に踏む経路を再現する (本プロジェクトの想定形は §9.5 参照)。

> **本プロジェクトの実装メモ** ── 上記は教科書的な一般論。現状のこのリポジトリでは **Integration も E2E もどちらも `vi.mock('../../config/auth', () => createAuthMock())` + `setSessionUser(TEST_USER)` でセッションを直接注入している** (`backend/src/__tests__/helpers/auth.ts`)。BetterAuth は **Google OAuth のみ** 有効化されており (`backend/src/config/auth.ts`)、E2E で本物経路を通すには (a) email/password プロバイダ追加 + `signInAsTestUser` ヘルパ実装、または (b) OAuth モックサーバー導入、のいずれかが必要。学習プロジェクト + E2E 1 本 (§8.4) という規模に対して投資過大と判断し、当面は **Integration と E2E は実装方式としては同居** させている。境目は「テストファイルが置かれているディレクトリ名」と「保証したい動線が複数エンドポイントの連鎖か単発か」のみ。将来 email/password を入れた時点で E2E を §9.5.1 の本物経路に寄せる予定 (§9.5.2 の現状形から移行)。

ひとことでまとめると、**「どのレイヤーを本物のまま走らせるか」が線引きで、関数の数やリクエストの本数は結果として変わってくるだけ** ── という構図です。これを念頭に、以下で各レイヤーの責務を見ていきます。

### 3.1 単体テスト (Unit Test)

- **対象**: 1 関数・1 メソッド・1 クラス
- **外部依存**: DB・HTTP・ファイル・時計・ランダム値などすべてモック
- **速度**: 1 本あたり 数 ms 〜 10 ms
- **数**: 数百〜数千本書ける
- **狙い**: ビジネスロジックの分岐網羅・境界値・エラーパターンを高速に検証

たとえば「日付文字列をパースして翌営業日を返す関数」や「割引額を計算する純粋関数」など、入力 → 出力が決まる部分を集中的に守ります。

### 3.2 結合テスト (Integration Test)

- **対象**: 複数レイヤーをまたぐ動作 (例: service → ORM → 実 DB)
- **外部依存**: DB は**本物の (テスト用) DB を使う**。S3・SES・SQS など SaaS はモック
- **速度**: 1 本あたり 100 ms 〜 数秒
- **数**: Unit の数分の 1 程度
- **狙い**: SQL の発行ミス・トランザクション境界・ORM のスキーマずれなど、モックでは見つからないバグを潰す

「Unit で全部モックすると嘘の挙動になりがち」な部分 (特に DB アクセス) は、ここで本物相手に検証します。

### 3.3 E2E テスト (End-to-End Test)

- **対象**: HTTP リクエスト → ルーター → 認証 → コントローラ → サービス → DB → レスポンス、までの全経路
- **外部依存**: 外部 SaaS のみモック、それ以外は本番に近い構成
- **速度**: 1 本あたり数秒
- **数**: 主要フローのハッピーパス中心に少数精鋭 (10 〜 30 本程度)
- **狙い**: 認証込みのフロー、ミドルウェアの順序、エンドツーエンドの契約 (リクエスト/レスポンス形) を守る

「ユーザーがログインしてリソースを作って一覧で取得できる」のような、**ビジネス上の主要ユースケース** をエンドツーエンドで保証します。エラー網羅は Unit/Integration に任せます。

---

## 4. 正常系テスト・異常系テスト・TDD

「あえて失敗するテストを書く」という言葉には実は **2 つの意味** があります。混同されがちなので分けて整理します。

### 4.1 正常系テストと異常系テスト

ひとつのエンドポイントや関数には、複数の振る舞いを検証する必要があります。

| 種類 | 検証内容 | 例 (POST /users) |
|------|---------|------------------|
| 正常系 | 期待通り動く | 正しい入力 → 201 + DB に行が増える |
| 異常系 | エラー時に正しくエラーになる | 不正な email → 400 + DB は変わらない |
|       |                              | 認証なし → 401 |
|       |                              | 重複 email → 409 |

異常系テストは「エラーになって**ほしい**」ケースを検証します。コードで書くと:

```ts
// 異常系の典型: バリデーションエラーを期待
it("不正な email では 400 を返し、DB には書き込まない", async () => {
  const res = await app.request("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  expect(res.status).toBe(400);
  expect(await db.select().from(users)).toHaveLength(0);
});

// 例外を期待する場合
it("認証されていないユーザーには UnauthorizedError を投げる", () => {
  expect(() => requireAuth(null)).toThrow("Unauthorized");
});
```

`expect(...).toThrow()` や `expect(res.status).toBe(400)` を書く瞬間が、いわゆる **「あえて失敗するテスト」の正体** です。失敗 (エラー) が**正解**なテストを書くわけです。

**どこで書くか**: 異常系は分岐パターンが多いため、Unit テストで網羅的に書くのが最も効率的です。E2E では「認証エラー」「主要バリデーションエラー」など代表的なものだけにとどめ、細かい異常系は Unit に任せます。

### 4.2 TDD (Red-Green-Refactor)

もうひとつ別の「失敗するテストを書く」文脈が **TDD (テスト駆動開発)** です。これはテストの種類ではなく**開発手法**であり、上記の異常系とは別の話です。

サイクルは 3 ステップ:

1. **Red**: 機能を実装する**前**に、まだ存在しない関数を呼ぶテストを書く → 当然失敗する (コンパイルエラーやアサート失敗)
2. **Green**: そのテストが通る**最小限**の実装を書く
3. **Refactor**: テストが通ったまま、コードを整える (重複削除、命名改善など)

```
仕様を書く → テストを書く (Red) → 実装 (Green) → 整理 (Refactor) → 次の仕様...
```

**なぜ先にテストを書くのか**:
- 実装より先に「この関数はどう呼ばれて何を返すべきか」を決められる (=仕様駆動)
- 後付けでテストを書こうとすると「テストしにくい設計」になりがちなのを防げる
- 「テストがある状態」を最初から保てる

**強制ではない**: TDD は強力な手法ですが、学習用プロジェクトで「常に TDD」にこだわる必要はありません。**「実装前に最低限テストの形を決めておく」程度の意識でも、後付けで全部書くよりずっと整います**。

### 4.3 まとめ: 「失敗するテスト」の 2 つの意味

| 文脈 | 意味 | 寿命 |
|------|------|------|
| 異常系テスト | エラーパスを検証するため、エラーが返ることを `expect` する | 恒久的に残る |
| TDD の Red | 実装より先にテストを書くと、まだ実装がないので失敗する | Green に持っていくまでの一時的状態 |

両方とも「失敗するテストを書く」と言えますが、目的も寿命も違います。

---

## 5. フレームワーク横断: 粒度の呼び方

呼称はフレームワークごとに違いますが、**「外部 I/O をどこまで本物にするか」** が判断軸という点は共通です。

| フレームワーク | Unit 相当 | Integration / Feature 相当 | E2E 相当 |
|---------------|----------|--------------------------|---------|
| Laravel (PHP) | `Tests/Unit` (純粋ロジック) | `Tests/Feature` (HTTP + 実 DB + マイグレーション) | 公式区分なし。Feature でカバー or Dusk (ブラウザ) |
| Hono (TS) | vitest/jest で関数単位 | vitest + `app.request()` + テスト用 DB | vitest or Playwright で実サーバー起動 |
| Express (TS) | jest で関数単位 | supertest + テスト用 DB | supertest + 実サーバー or Playwright |
| NestJS (TS) | jest で provider 単体 | jest + `Test.createTestingModule()` + 実 DB | jest + supertest で `app.listen()` |

Laravel は **Unit と Feature の 2 分類** が公式で、Feature が他フレームワークの Integration + E2E を兼ねるのが特徴です。Node 系 (Hono/Express/Nest) は **Unit / Integration / E2E の 3 層** に分けるのが慣習です。

---

## 6. テストしやすいコードの設計原則

テストの粒度を分けやすくする鍵は、**プロダクションコード側の設計** です。

1. **依存性注入 (DI)**: 外部依存を引数や DI コンテナで受け取り、テスト時に差し替え可能にする
2. **純粋関数を増やす**: 副作用 (DB 書き込み・現在時刻・乱数) を関数の外に追い出し、入力 → 出力だけの関数を増やす
3. **I/O とビジネスロジックを分離**: 「DB から取る」「メールを送る」を薄い層に閉じ込め、判定・計算・整形は別関数に切り出す

逆に言えば、**Unit テストが書きにくいコードはたいてい設計に問題がある** ということです。テストを書こうとして「モックだらけで何を検証してるのかわからない」状態になったら、まず関数分割を疑います。

---

## 7. モック・スタブの考え方

### モックすべき依存

- **遅い**: ネットワーク経由の SaaS、外部 API
- **不安定**: 外部サービスのレート制限、ネットワークの揺らぎ
- **課金される**: SES のメール送信、SMS、外部 API のクォータ
- **副作用が外に出る**: 本番メール送信、本番 Slack 通知

### モックすべきでない依存

- **DB**: アプリの振る舞いの中心であり、モックすると SQL のミスを発見できない。Integration では実 DB を使う
- **自プロジェクト内の関数**: 同じリポジトリ内のロジックをモックすると、テスト対象がほぼ空洞になる

### 「モックしすぎたテスト」の罠

`when(repo.find).thenReturn(user)` のようにモックの返り値を固定するだけのテストを大量に書くと、**コードを書き写しただけで何も検証していない** 状態になります。「リファクタしたら一斉に壊れるが、バグは見つけてくれない」テストの典型です。

判断目安: **「この関数がどこに何を渡しているか」だけを assert していたらモックしすぎ**。「最終的に何がどうなったか」を assert する方向に書き換えます。

---

## 8. すべてのテストを必ず書く必要はあるか — プロジェクト規模と取捨選択

### 8.1 結論: 必須ではない。何を守りたいかで決まる

3 種類のテスト (Unit / Integration / E2E) は **すべて書ければベスト** ですが、書く時間とメンテ時間もかかります。どこまでやるかは **「壊れたら困る度合い」 × 「壊れやすさ」** で判断します。

- 壊れたらユーザーに迷惑がかかる部分 → テストを手厚く
- 壊れても影響が小さい / すぐ気づける部分 → テストを省略 or 後回し

### 8.2 規模ごとの典型パターン

| 規模 | 推奨構成 | 例 |
|------|---------|-----|
| 個人プロトタイプ / ハッカソン | E2E 数本のみ、または 0 本 | 動けばよい、捨てる前提のコード |
| 学習プロジェクト | **Unit 中心 + 主要 Integration 数本** | **本プロジェクトはここ** |
| 小規模サービス (本番運用) | Unit + Integration + 主要 E2E 1〜3 本 | 個人開発の SaaS |
| 中〜大規模サービス | フルピラミッド + CI 必須 | チーム開発・課金がからむ本番サービス |

「規模が大きくなるほど、自分が把握しきれない部分が増える」── それを補うために自動テストの密度を上げます。逆に言えば、小さく短命なコードに分厚いテストを書くのは過剰投資です。

### 8.3 「これは書く / これは書かなくていい」の判断

**必ず書くべき**:
- お金が動くロジック (決済、ポイント計算など)
- 認証・権限判定 (誰がどこを見られるか)
- ユーザーデータが消える可能性のある操作 (削除、上書き)
- 複雑な分岐・計算 (割引、税金、日付計算など)

**書かなくていい / 後回しでよい**:
- 設定ファイルの読み込み (壊れたら起動時にすぐ気づく)
- フレームワーク標準機能の薄いラッパー (フレームワーク側がテスト済み)
- ライブラリの再 export
- 管理画面の補助機能・内部用デバッグエンドポイント

### 8.4 本プロジェクトへの推奨ライン

本プロジェクトは **学習用 + 中規模 + 本番投入予定あり** という性質なので、以下を最初の目標とします。

| 対象 | テスト | 優先度 |
|------|--------|--------|
| `services/` のロジック関数 (QR 生成、メール送信、ストレージ) | Unit (正常系 + 異常系) | **最優先** |
| `routes/` 主要エンドポイント (users / qrcodes) | Integration 各 1〜2 本 | 高 |
| ログイン → QR 作成 → 一覧取得 のハッピーパス | E2E 1 本 | 中 |
| 設定ファイル (`config/`)・ヘルスチェック・SDK の薄いラッパー | 書かない | — |

**重要**: いきなり全エンドポイント・全レイヤーをカバーしようとすると挫折します。**まずこのラインを目標**にし、運用しながら「壊れたら困った部分」だけ追加していくのが現実的です。

---

## 9. 本プロジェクトへの適用

本プロジェクトのレイヤー構造 (`backend/src/`) は以下です。

```
routes/        Hono ルーター。URL とハンドラの紐付け、zod バリデーション
  ↓
controllers/   リクエスト解釈、レスポンス整形、HTTP ステータス決定
  ↓
services/      ビジネスロジック (QR 生成、メール送信、ストレージ操作)
  ↓
db/ (Drizzle)  スキーマ定義 + ORM クエリ
  ↓
MySQL          実 DB
```

外部依存: **S3 / SES / SQS** (AWS SDK)、**BetterAuth** (Google OAuth)、**Nodemailer** (メール)。

### 9.1 レイヤー対応表

| レイヤー / 対象 | テスト種別 | DB | AWS (S3/SES/SQS) | 認証 |
|---------------|-----------|----|----|------|
| `services/` のロジック | Unit | モック | モック | 不要 |
| `controllers/` | Unit (or 軽い Integration) | services をモック | モック | 不要 |
| `routes/` + DB アクセス | Integration | **テスト用 MySQL (実物)** | モック | モック (`vi.mock` で getAuth 差し替え) |
| ログイン〜CRUD の主要フロー | E2E | テスト用 MySQL | モック | **理想: 本物の経路を通す / 現状: Integration と同じくセッション注入** |
| `lambda.ts` / `sqs-handler.ts` のハンドラ | Integration | モック or 実物 | モック | — |

> **現状の妥協点**: BetterAuth が Google OAuth のみのため、E2E でも本物の OAuth 経路は通せず、Integration と同じセッション注入方式で代替している (詳細は §3 末尾の実装メモおよび §9.5.2)。

### 9.2 疑似コード: Unit テスト (純粋ロジック)

`services/qrcode.service.ts` の中で純粋にデータ整形だけしている関数を切り出しているケースを想定します。

```ts
// services/qrcode.helpers.ts (純粋関数に切り出してある想定)
export function buildQrFileName(userId: string, createdAt: Date): string {
  return `qr/${userId}/${createdAt.toISOString()}.png`;
}

// __tests__/qrcode.helpers.test.ts
import { describe, it, expect } from "vitest";
import { buildQrFileName } from "../services/qrcode.helpers";

describe("buildQrFileName", () => {
  it("ユーザー ID と日時から S3 キーを生成する", () => {
    const result = buildQrFileName("user-1", new Date("2026-01-01T00:00:00Z"));
    expect(result).toBe("qr/user-1/2026-01-01T00:00:00.000Z.png");
  });
});
```

DB も AWS も触らないので 1 ms 以下で終わります。境界値や異常系もここに集中させます。

### 9.3 疑似コード: Service の Unit テスト (依存をモック)

```ts
// __tests__/qrcode.service.test.ts
import { describe, it, expect, vi } from "vitest";
import { QrCodeService } from "../services/qrcode.service";

describe("QrCodeService.generate", () => {
  it("QR を生成して S3 に保存し、URL を返す", async () => {
    const s3Mock = { upload: vi.fn().mockResolvedValue({ key: "qr/foo.png" }) };
    const qrLibMock = { toBuffer: vi.fn().mockResolvedValue(Buffer.from("png")) };

    const service = new QrCodeService(s3Mock as any, qrLibMock as any);
    const url = await service.generate("user-1", "hello");

    expect(qrLibMock.toBuffer).toHaveBeenCalledWith("hello");
    expect(s3Mock.upload).toHaveBeenCalledOnce();
    expect(url).toContain("qr/foo.png");
  });
});
```

ポイントは **`QrCodeService` が S3 クライアントと QR ライブラリをコンストラクタで受け取る (DI) 設計** になっていること。現状の `services/` がそうなっていない場合は、テストを書く過程でリファクタが必要になります (テストしやすさは設計の鏡)。

### 9.4 疑似コード: Integration テスト (実 DB + Hono ルーター)

Hono は `app.request()` でサーバーを起動せずにルーティングをテストできます。

```ts
// __tests__/users.route.integration.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../app";
import { db } from "../config/database";
import { users } from "../db/schema";

beforeEach(async () => {
  await db.delete(users); // テスト用 MySQL を毎回クリーン
});

describe("POST /users", () => {
  it("ユーザーを作成して DB に保存される", async () => {
    const res = await app.request("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
    });

    expect(res.status).toBe(201);
    const stored = await db.select().from(users);
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe("alice@example.com");
  });
});
```

ここでは **実 DB に書き込まれた結果** を assert しているのが Integration の典型形です。SQL の typo・カラム名のずれ・トランザクション境界などはこの層でしか発見できません。

### 9.5 疑似コード: E2E テスト (認証込み主要フロー)

> **注記**: 本プロジェクトでは BetterAuth が Google OAuth のみで email/password が未導入のため、下記 §9.5.1 の `signInAsTestUser` は **未実装** (理想形のリファレンスとして残す)。実物の E2E (`backend/src/__tests__/e2e/qrcode-flow.test.ts`) は §9.5.2 の妥協形を取っている。詳細な背景は §3 末尾の「本プロジェクトの実装メモ」を参照。

#### 9.5.1 理想形: 本物の認証経路を通す (将来移行先)

```ts
// __tests__/e2e/qr-flow.test.ts
import { describe, it, expect } from "vitest";
import { app } from "../app";
import { signInAsTestUser } from "./helpers/auth";

describe("E2E: ログインして QR を作成して取得する", () => {
  it("ハッピーパス全体が通る", async () => {
    const cookie = await signInAsTestUser(); // BetterAuth の経路を通してセッション作成

    const created = await app.request("/qrcodes", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "https://example.com" }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const got = await app.request(`/qrcodes/${id}`, { headers: { Cookie: cookie } });
    expect(got.status).toBe(200);
    expect((await got.json()).payload).toBe("https://example.com");
  });
});
```

E2E は **本物の認証経路を通す** ことと、**エラー網羅をしすぎない** (それは Unit/Integration の仕事) ことが要点です。S3 や SES は引き続きモック ── 実際に S3 にオブジェクトを置きにいくテストは CI で不安定化しやすいためです。

#### 9.5.2 現状形: セッション注入で代替 (本プロジェクトの実物)

`backend/src/__tests__/e2e/qrcode-flow.test.ts` は次の形を取っている (抜粋):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthMock, setSessionUser, TEST_USER } from '../helpers/auth';
import { cleanupDb } from '../helpers/db';

// getAuth() モジュールごと差し替え。`import app` より先に評価される必要があるため最上部に置く。
vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db } from '../../config/database';
import { users } from '../../db/schema';

beforeEach(async () => {
  await cleanupDb();
  setSessionUser(TEST_USER);                                       // 「ログイン済み」を装う
  await db.insert(users).values({ id: TEST_USER.id, /* ... */ });  // FK 整合のため実 DB にも入れる
});

it('ハッピーパス', async () => {
  const created = await app.request('/api/qrcodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'https://example.com' }),
  });
  expect(created.status).toBe(201);
  // ... GET /api/qrcodes で作成済み QR が含まれることを assert
});
```

§9.5.1 との違いは **認証経路を通さず、セッションを直接注入している** 点のみ。それ以外 (実 DB、S3 モック、ハッピーパスの動線) は同じ。

これは妥協形だが、Google OAuth しか有効でない現状では「本物経路の E2E」を実現するコスト (email/password プロバイダ追加 / OAuth モックサーバー導入) が学習プロジェクトの規模に対して過大なため採用している。BetterAuth に email/password を追加した時点で §9.5.1 の本物経路へ移行する。

### 9.6 外部依存の扱い方針 (本プロジェクト固有)

| 依存 | Unit | Integration | E2E |
|------|------|------------|-----|
| MySQL (Drizzle) | モック | **実 (テスト用 DB)** | **実 (テスト用 DB)** |
| S3 | モック | モック | モック |
| SES (メール送信) | モック | モック | モック |
| SQS | モック | モック | モック |
| BetterAuth (Google OAuth) | 不要 | `vi.mock` で getAuth 差し替え + `setSessionUser` | **現状: Integration と同じ (`vi.mock` でセッション注入)** / 理想: 本物経路 (§9.5.1) |
| Nodemailer | モック (送信せず内容を assert) | 同左 | 同左 |

AWS SDK のモックは `aws-sdk-client-mock` を使うのが定番です。テスト用 MySQL は Docker Compose に既にある dev 用 MySQL とは**別コンテナ** (例: ポート違い・DB 名違い) で立てるとデータ汚染が起きません。

認証列について補足: 一般論としては Integration は「Cookie/ヘッダ偽装」で十分なことが多いが、本プロジェクトでは **モジュールごと `vi.mock` で差し替える方式** を採用している (`backend/src/__tests__/helpers/auth.ts` の `createAuthMock`)。これにより、テスト側からは `setSessionUser(user)` だけでセッションを差し替えられ、`getSession()` の呼び出し経路を辿らずに済む。E2E も同じ仕組みを共用しているのが現状の妥協点 (§3 末尾の実装メモ参照)。

---

## 10. 推奨ツール

| 用途 | 推奨 | 理由 |
|------|------|------|
| テストランナー | **Vitest** | TypeScript ネイティブ、esm 対応、watch が速い。Hono 公式ドキュメントでも採用例 |
| HTTP テスト | Hono の `app.request()` | 実サーバーを起動せずルーターを通せる。supertest 不要 |
| DB | テスト用 **MySQL コンテナ** | 本番と同じ MySQL 8.0 を使えば SQL の差異が出ない |
| AWS モック | `aws-sdk-client-mock` | S3/SES/SQS の v3 SDK 対応、宣言的に書ける |
| アサーション | Vitest 同梱の `expect` | 追加導入不要 |

---

## 11. 何から始めるか

8.4 で示した推奨ラインを最終目標に、段階的に積み上げます。いきなり全レイヤーに手をつけず、以下の順序を推奨します。

1. **Vitest を導入し、`services/` の純粋ロジックを 1 本 Unit テスト** ── 道具と書き味に慣れる
2. **Service を依存注入できるようにリファクタしつつ、外部依存をモックした Unit テストを増やす** ── 設計改善が伴う
3. **テスト用 MySQL を立て、`routes/` の Integration テストを 1 エンドポイント書く** ── DB を絡めた assert の感覚を掴む
4. **主要フロー (ログイン → CRUD) の E2E テストを 1〜2 本書く** ── 全体経路をハッピーパスで守る
5. CI への組み込み・カバレッジ計測などは別ドキュメントで扱う

最初の 1 本を書くまでが一番大変で、書いた後は同じパターンの横展開になります。**まずは Unit テスト 1 本**を最小ゴールにして取り組むのが進めやすいです。
