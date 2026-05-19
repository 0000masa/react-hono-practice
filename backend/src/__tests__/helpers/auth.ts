import { vi } from 'vitest';
import type { AuthUser } from '../../types/index';

// 認証ミドルウェアは config/auth の getAuth() を使うため、
// テストでは getAuth().api.getSession() の戻り値を制御することで認証状態を作る。
//
// 使い方:
//   vi.mock('../../config/auth', () => createAuthMock());
//   import { setSessionUser, clearSession } from '../helpers/auth';
//   beforeEach(() => { setSessionUser({ id: 1, ... }) });

export type SessionState = {
  user: AuthUser | null;
};

const state: SessionState = { user: null };

export const sessionState = state;

export function setSessionUser(user: AuthUser): void {
  state.user = user;
}

export function clearSession(): void {
  state.user = null;
}

// vi.mock のファクトリで返すオブジェクト。`getAuth()` を呼ぶたびに最新の state を見るので
// テストごとに setSessionUser / clearSession で挙動を切り替えられる。
export function createAuthMock() {
  return {
    getAuth: () => ({
      api: {
        getSession: vi.fn(async () => {
          if (!state.user) return null;
          return { user: state.user };
        }),
        // Better Auth ハンドラ自体は app.ts で onError 経由で呼ばれるが、
        // /api/auth/* を叩かないテストでは未使用。
      },
      handler: vi.fn(async () => new Response(null, { status: 404 })),
    }),
  };
}

export const TEST_USER: AuthUser = {
  id: 1,
  name: 'テストユーザー',
  email: 'test@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
