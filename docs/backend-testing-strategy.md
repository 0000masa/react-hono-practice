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

## 4. フレームワーク横断: 粒度の呼び方

呼称はフレームワークごとに違いますが、**「外部 I/O をどこまで本物にするか」** が判断軸という点は共通です。

| フレームワーク | Unit 相当 | Integration / Feature 相当 | E2E 相当 |
|---------------|----------|--------------------------|---------|
| Laravel (PHP) | `Tests/Unit` (純粋ロジック) | `Tests/Feature` (HTTP + 実 DB + マイグレーション) | 公式区分なし。Feature でカバー or Dusk (ブラウザ) |
| Hono (TS) | vitest/jest で関数単位 | vitest + `app.request()` + テスト用 DB | vitest or Playwright で実サーバー起動 |
| Express (TS) | jest で関数単位 | supertest + テスト用 DB | supertest + 実サーバー or Playwright |
| NestJS (TS) | jest で provider 単体 | jest + `Test.createTestingModule()` + 実 DB | jest + supertest で `app.listen()` |

Laravel は **Unit と Feature の 2 分類** が公式で、Feature が他フレームワークの Integration + E2E を兼ねるのが特徴です。Node 系 (Hono/Express/Nest) は **Unit / Integration / E2E の 3 層** に分けるのが慣習です。

---

## 5. テストしやすいコードの設計原則

テストの粒度を分けやすくする鍵は、**プロダクションコード側の設計** です。

1. **依存性注入 (DI)**: 外部依存を引数や DI コンテナで受け取り、テスト時に差し替え可能にする
2. **純粋関数を増やす**: 副作用 (DB 書き込み・現在時刻・乱数) を関数の外に追い出し、入力 → 出力だけの関数を増やす
3. **I/O とビジネスロジックを分離**: 「DB から取る」「メールを送る」を薄い層に閉じ込め、判定・計算・整形は別関数に切り出す

逆に言えば、**Unit テストが書きにくいコードはたいてい設計に問題がある** ということです。テストを書こうとして「モックだらけで何を検証してるのかわからない」状態になったら、まず関数分割を疑います。

---

## 6. モック・スタブの考え方

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

## 7. 本プロジェクトへの適用

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

### 7.1 レイヤー対応表

| レイヤー / 対象 | テスト種別 | DB | AWS (S3/SES/SQS) | 認証 |
|---------------|-----------|----|----|------|
| `services/` のロジック | Unit | モック | モック | 不要 |
| `controllers/` | Unit (or 軽い Integration) | services をモック | モック | 不要 |
| `routes/` + DB アクセス | Integration | **テスト用 MySQL (実物)** | モック | モック |
| ログイン〜CRUD の主要フロー | E2E | テスト用 MySQL | モック | **本物の経路を通す** |
| `lambda.ts` / `sqs-handler.ts` のハンドラ | Integration | モック or 実物 | モック | — |

### 7.2 疑似コード: Unit テスト (純粋ロジック)

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

### 7.3 疑似コード: Service の Unit テスト (依存をモック)

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

### 7.4 疑似コード: Integration テスト (実 DB + Hono ルーター)

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

### 7.5 疑似コード: E2E テスト (認証込み主要フロー)

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

### 7.6 外部依存の扱い方針 (本プロジェクト固有)

| 依存 | Unit | Integration | E2E |
|------|------|------------|-----|
| MySQL (Drizzle) | モック | **実 (テスト用 DB)** | **実 (テスト用 DB)** |
| S3 | モック | モック | モック |
| SES (メール送信) | モック | モック | モック |
| SQS | モック | モック | モック |
| BetterAuth (Google OAuth) | 不要 | Cookie/ヘッダ偽装 | テストユーザーで本物の経路 |
| Nodemailer | モック (送信せず内容を assert) | 同左 | 同左 |

AWS SDK のモックは `aws-sdk-client-mock` を使うのが定番です。テスト用 MySQL は Docker Compose に既にある dev 用 MySQL とは**別コンテナ** (例: ポート違い・DB 名違い) で立てるとデータ汚染が起きません。

---

## 8. 推奨ツール

| 用途 | 推奨 | 理由 |
|------|------|------|
| テストランナー | **Vitest** | TypeScript ネイティブ、esm 対応、watch が速い。Hono 公式ドキュメントでも採用例 |
| HTTP テスト | Hono の `app.request()` | 実サーバーを起動せずルーターを通せる。supertest 不要 |
| DB | テスト用 **MySQL コンテナ** | 本番と同じ MySQL 8.0 を使えば SQL の差異が出ない |
| AWS モック | `aws-sdk-client-mock` | S3/SES/SQS の v3 SDK 対応、宣言的に書ける |
| アサーション | Vitest 同梱の `expect` | 追加導入不要 |

---

## 9. 何から始めるか

いきなり全レイヤーに手をつけず、以下の順序を推奨します。

1. **Vitest を導入し、`services/` の純粋ロジックを 1 本 Unit テスト** ── 道具と書き味に慣れる
2. **Service を依存注入できるようにリファクタしつつ、外部依存をモックした Unit テストを増やす** ── 設計改善が伴う
3. **テスト用 MySQL を立て、`routes/` の Integration テストを 1 エンドポイント書く** ── DB を絡めた assert の感覚を掴む
4. **主要フロー (ログイン → CRUD) の E2E テストを 1〜2 本書く** ── 全体経路をハッピーパスで守る
5. CI への組み込み・カバレッジ計測などは別ドキュメントで扱う

最初の 1 本を書くまでが一番大変で、書いた後は同じパターンの横展開になります。**まずは Unit テスト 1 本**を最小ゴールにして取り組むのが進めやすいです。
