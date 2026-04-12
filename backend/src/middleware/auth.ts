import { createMiddleware } from 'hono/factory';
import { getAuth } from '../config/auth';
import type { AuthUser, Env } from '../types/index';

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const session = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  const user: AuthUser = {
    id: Number(session.user.id),
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image ?? null,
    createdAt: session.user.createdAt,
    updatedAt: session.user.updatedAt,
  };

  c.set('user', user);
  await next();
});
