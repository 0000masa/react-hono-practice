import type { Context } from 'hono';
import { desc, count } from 'drizzle-orm';
import { db } from '../config/database';
import { users } from '../db/schema';
import type { Env, PaginationMeta } from '../types/index';

const PER_PAGE = 50;

export async function index(c: Context<Env>) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const offset = (page - 1) * PER_PAGE;

  const [totalResult] = await db.select({ count: count() }).from(users);
  const total = totalResult.count;

  const userList = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(PER_PAGE)
    .offset(offset);

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total > 0 ? offset + 1 : null;
  const to = total > 0 ? Math.min(offset + PER_PAGE, total) : null;

  const pagination: PaginationMeta = {
    // 現在のページ番号。クエリの ?page=N から取得し、最小値は 1。
    current_page: page,
    // 最後のページ番号 (= 総ページ数)。total / PER_PAGE の切り上げで、最小値は 1
    // (total=0 でも 1 を返すことで「空の 1 ページ目」を表現する)。
    last_page: lastPage,
    // 1 ページあたりの最大件数 (このエンドポイントでは固定 50 件)。
    per_page: PER_PAGE,
    // 全件数 (users テーブルに存在するレコードの総数)。フィルタはかかっていない。
    total,
    // このページが返している範囲の「最初の件数番号」(1 始まり、両端を含む)。
    // 例: page=2, per_page=50 なら 51。total=0 のときは null。
    from,
    // このページが返している範囲の「最後の件数番号」(1 始まり、両端を含む)。
    // 例: page=2 で 51〜80 件目を返すなら 80。最終ページが端数なら total と同値。
    // total=0 のときは null。
    to,
  };

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatar_url: u.image,
      created_at: u.createdAt,
    })),
    pagination,
  });
}
