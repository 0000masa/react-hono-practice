import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './database';
import * as schema from '../db/schema';
import { env } from './env';

// betterAuth() をモジュール読み込み時に実行すると、本番環境（IAM 認証）では
// db がまだ未初期化（undefined）のため失敗する。
// 遅延初期化にして、最初のリクエスト時（initDatabase() 完了後）に生成する。
function createAuth() {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'mysql',
      schema,
      usePlural: true,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.FRONTEND_URL,
    basePath: '/api/auth',
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    trustedOrigins: [env.FRONTEND_URL],
    advanced: {
      database: {
        generateId: false,
      },
    },
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  _auth ??= createAuth();
  return _auth;
}
