import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users } from '../db/schema.js';
import type { Env } from '../types/index.js';

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const session = c.get('session');

  if (!session?.userId) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  c.set('user', user);
  await next();
});
