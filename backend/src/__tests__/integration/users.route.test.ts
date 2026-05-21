/**
 * `/api/users` エンドポイントの **インテグレーションテスト**。
 *
 * 何をテストしているか:
 *   `GET /api/users` のみ (controllers/users.controller.ts の `index`)
 *     - 異常系: 認証なし → 401
 *     - 正常系: ユーザー 0 件 → 200 + 空配列 + pagination が 0 件用の値
 *     - 正常系: 複数ユーザー → createdAt DESC 順 + レスポンス JSON の形
 *               (キー名 `avatar_url` / image が null のときの扱い等)
 *     - 正常系: 51 件 (per_page=50 の境界 +1) で page=2 → ページング境界の
 *               値 (last_page / from / to / current_page) が正しい
 *
 * 何は **本物** を使い、何を **モック** にしているか:
 *   - 本物: Hono アプリ全体、ルーティング、Drizzle 経由の DB (テスト用 MySQL)
 *   - モック: 認証 (better-auth の `getAuth()`)
 *   - 外部 SDK (S3 / SQS / SES) はこのルートでは使わないのでセットアップなし。
 *
 * いつ実行されるか:
 *   `__tests__/integration/**\/*.test.ts` を対象にする
 *   `vitest.integration.config.ts` 経由。`npm run test:integration` で走る。
 */
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { createAuthMock, setSessionUser, clearSession, TEST_USER } from '../helpers/auth';
import { cleanupDb } from '../helpers/db';

// authMiddleware が呼ぶ getAuth() を差し替える。
// vi.mock は他の import より先に巻き上げられるため app.ts より上に書く。
// (qrcodes.route.test.ts と同じ理由。詳細はそちらのコメント参照)
vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db, pool } from '../../config/database';
import { users } from '../../db/schema';

// テストで使う固定ユーザー群を 1 クエリの bulk insert で作るヘルパ。
//
// 工夫:
//   - id を 1〜n の連番で **明示指定** する (auto_increment に任せると並び順は
//     担保されるが、テスト内で具体値を assert したいので固定する)
//   - createdAt を i*1000 ms ずつズラす → 「id 昇順 = createdAt 昇順」の対応が
//     成立する。controller は `createdAt DESC` でソートするため、レスポンスは
//     id 降順 (= 新しい順) で並ぶはずである、というアサーションを書きやすくする
//   - image は偶数 i だけ URL、奇数 i は null。これでレスポンス側の
//     `avatar_url` が「URL のとき」「null のとき」両方を 1 ケースで確認できる
//   - emailVerified は users.emailVerified が NOT NULL のため明示
async function insertUsers(n: number): Promise<void> {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  await db.insert(users).values(
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `user-${i + 1}`,
      email: `user-${i + 1}@example.com`,
      emailVerified: true,
      image: i % 2 === 0 ? `https://example.com/avatar-${i + 1}.png` : null,
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + i * 1000),
    })),
  );
}

beforeEach(async () => {
  await cleanupDb();
  clearSession();
});

afterAll(async () => {
  await pool?.end();
});

describe('GET /api/users', () => {
  it('異常系: 認証なしなら 401 を返す', async () => {
    // beforeEach の clearSession を経た「未ログイン状態」のまま叩く。
    // authMiddleware が弾くので DB クエリよりも先に 401 が返るはず。
    const res = await app.request('/api/users');
    expect(res.status).toBe(401);
  });

  it('正常系: 認証済みで 0 件のとき 200 + 空配列 + pagination が 0 件用の値', async () => {
    // ログイン状態だけ作る。DB には users を 1 件も入れない。
    setSessionUser(TEST_USER);

    const res = await app.request('/api/users');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      users: unknown[];
      pagination: {
        current_page: number;
        last_page: number;
        per_page: number;
        total: number;
        from: number | null;
        to: number | null;
      };
    };

    // users 配列は **null や undefined ではなく** 空配列を返す契約。
    // フロント側が `body.users.map(...)` で安全に回せるための前提。
    expect(body.users).toEqual([]);

    // 0 件用の pagination 値:
    //   - total = 0
    //   - from / to は null (controller の `total > 0 ? ... : null` 分岐)
    //   - last_page は `Math.max(1, Math.ceil(0/50)) = 1` (0 にならない)
    //   - per_page は 50 固定
    // → from / to が 0 や undefined になると Laravel 風ペジネータの慣習を
    //    踏み外して UI が壊れるので、ここで明示的に null を固定する。
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.from).toBeNull();
    expect(body.pagination.to).toBeNull();
    expect(body.pagination.last_page).toBe(1);
    expect(body.pagination.current_page).toBe(1);
    expect(body.pagination.per_page).toBe(50);
  });

  it('正常系: 複数ユーザー → createdAt DESC 順 + image→avatar_url マッピング', async () => {
    // ログインユーザーを兼ねる id=1 を含む 3 件を投入。
    // (`TEST_USER.id === 1` で、insertUsers が id=1 を作るため、ログインユーザーが
    //  そのまま結果セットの 1 件として現れる構図)
    setSessionUser(TEST_USER);
    await insertUsers(3);

    const res = await app.request('/api/users');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      users: Array<{
        id: number;
        name: string;
        email: string;
        avatar_url: string | null;
        created_at: string;
      }>;
      pagination: { total: number; last_page: number; from: number | null; to: number | null };
    };

    // 件数とページング (3 件 ≤ per_page=50 なので 1 ページに収まる)
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.last_page).toBe(1);
    expect(body.pagination.from).toBe(1);
    expect(body.pagination.to).toBe(3);
    expect(body.users).toHaveLength(3);

    // --- ソート順の検証 ---
    // controller は `orderBy(desc(users.createdAt))`。
    // insertUsers は createdAt を i 昇順で 1 秒ズラしているので、
    // i=2 (id=3) が最新、i=0 (id=1) が最古。結果は id=3, 2, 1 の順。
    expect(body.users.map((u) => u.id)).toEqual([3, 2, 1]);

    // --- レスポンスの形 (キー集合) の検証 ---
    // 「`image` ではなく `avatar_url` で返す」「余計なキーが漏れていない
    //  (例: emailVerified, updatedAt がうっかり露出していない)」を固定する。
    // `Object.keys(...).sort()` を使うのは、JSON のキー順に依存しない比較に
    // するため。
    expect(Object.keys(body.users[0]).sort()).toEqual(
      ['avatar_url', 'created_at', 'email', 'id', 'name'].sort(),
    );

    // --- avatar_url マッピング ---
    // - id=3 (i=2, 偶数) → image あり → avatar_url が URL 文字列
    // - id=2 (i=1, 奇数) → image なし → avatar_url が null (キーは存在する)
    // 「image を null のまま avatar_url に流す」契約を固定。
    // フロントが「キー無し」と「null」を別扱いするケースを救済する。
    const byId = Object.fromEntries(body.users.map((u) => [u.id, u]));
    expect(byId[3].avatar_url).toBe('https://example.com/avatar-3.png');
    expect(byId[2].avatar_url).toBeNull();
  });

  it('正常系: 51 件投入 / page=2 でページング境界が正しい', async () => {
    setSessionUser(TEST_USER);
    // per_page=50 ちょうど + 1 件。
    // 50 件: 1 ページ目で全件返る境界
    // 51 件: ちょうどはみ出して 2 ページ目に 1 件残る境界
    // ここで踏みたいのは後者 (last_page=2 になるギリギリの最小数)。
    await insertUsers(51);

    const res = await app.request('/api/users?page=2');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      users: Array<{ id: number }>;
      pagination: {
        current_page: number;
        last_page: number;
        per_page: number;
        total: number;
        from: number | null;
        to: number | null;
      };
    };

    // page=2 にはみ出した 1 件だけが返る。
    expect(body.users).toHaveLength(1);

    // page=2 の境界値:
    //   - current_page=2, per_page=50, total=51, last_page=Math.ceil(51/50)=2
    //   - from = offset + 1 = 50 + 1 = 51
    //   - to   = min(offset + per_page, total) = min(100, 51) = 51
    // ここの from / to が片側だけ NaN や null になるバグ (off-by-one) を
    // 固定するための境界値テスト。
    expect(body.pagination.current_page).toBe(2);
    expect(body.pagination.last_page).toBe(2);
    expect(body.pagination.per_page).toBe(50);
    expect(body.pagination.total).toBe(51);
    expect(body.pagination.from).toBe(51);
    expect(body.pagination.to).toBe(51);

    // createdAt DESC ソート + 1 秒ズラしの insertUsers なので、
    // id=51 が最新、id=1 が最古。page=2 に残るのは最古 = id=1。
    // → 「ページの **末尾** までソートが効いているか」も同時に確認できる。
    expect(body.users[0].id).toBe(1);
  });
});
