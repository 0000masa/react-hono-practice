import type { Context } from 'hono';
import { generateState, generateCodeVerifier } from 'arctic';
import { eq, or } from 'drizzle-orm';
import { google } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { env } from '../config/env';
import { setSession, destroySession } from '../middleware/session';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types/index';

export async function redirectToGoogle(c: Context<Env>) {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const scopes = ['openid', 'email', 'profile'];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);

  setCookie(c, 'google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProduction,
    maxAge: 60 * 10,
    path: '/',
  });

  setCookie(c, 'google_code_verifier', codeVerifier, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProduction,
    maxAge: 60 * 10,
    path: '/',
  });

  return c.json({ url: url.toString() });
}

export async function handleGoogleCallback(c: Context<Env>) {
  const { code, state } = c.req.query();
  const storedState = getCookie(c, 'google_oauth_state');
  const codeVerifier = getCookie(c, 'google_code_verifier');

  if (!code || !state || state !== storedState || !codeVerifier) {
    return c.redirect(`${env.FRONTEND_URL}/auth/error`);
  }

  try {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const googleUser = (await response.json()) as {
      id: string;
      name: string;
      email: string;
      picture: string;
    };

    let [existingUser] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.googleId, googleUser.id),
          eq(users.email, googleUser.email),
        ),
      )
      .limit(1);

    if (existingUser) {
      await db
        .update(users)
        .set({
          googleId: googleUser.id,
          avatarUrl: googleUser.picture,
          emailVerifiedAt: existingUser.emailVerifiedAt ?? new Date(),
        })
        .where(eq(users.id, existingUser.id));

      existingUser = {
        ...existingUser,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
      };
    } else {
      const [result] = await db.insert(users).values({
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        password: null,
        emailVerifiedAt: new Date(),
      }).$returningId();

      existingUser = {
        id: result.id,
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        password: null,
        emailVerifiedAt: new Date(),
        rememberToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    setSession(c, { userId: existingUser.id });

    deleteCookie(c, 'google_oauth_state');
    deleteCookie(c, 'google_code_verifier');

    return c.redirect(`${env.FRONTEND_URL}/auth/callback`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    return c.redirect(`${env.FRONTEND_URL}/auth/error`);
  }
}

export async function getUser(c: Context<Env>) {
  const user = c.get('user');
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatarUrl,
    },
  });
}

export async function logout(c: Context<Env>) {
  await destroySession(c);
  deleteCookie(c, 'hono_session', { path: '/' });
  return c.json({ message: 'ログアウトしました' });
}
