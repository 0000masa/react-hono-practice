import { createMiddleware } from 'hono/factory';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { sessions } from '../db/schema.js';
import { env } from '../config/env.js';
import type { Env, SessionData } from '../types/index.js';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const COOKIE_NAME = 'hono_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  let sessionId = getCookie(c, COOKIE_NAME) ?? '';
  let sessionData: SessionData = {};
  let isNew = false;

  if (sessionId) {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (row?.payload) {
      try {
        sessionData = JSON.parse(row.payload) as SessionData;
      } catch {
        sessionData = {};
      }
    } else {
      sessionId = '';
    }
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    isNew = true;
  }

  c.set('session', sessionData);
  c.set('sessionId', sessionId);
  c.set('sessionChanged', false);

  await next();

  const changed = c.get('sessionChanged') || isNew;
  if (changed) {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(c.get('session'));
    const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = c.req.header('user-agent') ?? null;

    if (isNew) {
      await db.insert(sessions).values({
        id: sessionId,
        userId: c.get('session').userId ? Number(c.get('session').userId) : null,
        ipAddress,
        userAgent,
        payload,
        lastActivity: now,
      });
    } else {
      await db
        .update(sessions)
        .set({
          userId: c.get('session').userId ? Number(c.get('session').userId) : null,
          payload,
          lastActivity: now,
        })
        .where(eq(sessions.id, sessionId));
    }

    setCookie(c, COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: env.isProduction,
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
  }
});

export function setSession(c: { set: (key: string, value: unknown) => void; get: (key: string) => unknown }, data: Partial<SessionData>): void {
  const session = (c.get('session') ?? {}) as SessionData;
  Object.assign(session, data);
  c.set('session', session);
  c.set('sessionChanged', true);
}

export async function destroySession(c: { get: (key: string) => unknown; set: (key: string, value: unknown) => void }): Promise<void> {
  const sessionId = c.get('sessionId') as string;
  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
  c.set('session', {});
  c.set('sessionChanged', false);
}
