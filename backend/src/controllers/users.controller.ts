import type { Context } from 'hono';
import { desc, count } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users } from '../db/schema.js';
import type { Env, PaginationMeta } from '../types/index.js';

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
      avatarUrl: users.avatarUrl,
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
    current_page: page,
    last_page: lastPage,
    per_page: PER_PAGE,
    total,
    from,
    to,
  };

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatar_url: u.avatarUrl,
      created_at: u.createdAt,
    })),
    pagination,
  });
}
