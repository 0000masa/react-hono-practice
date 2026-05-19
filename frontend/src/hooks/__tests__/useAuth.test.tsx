import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    signOut: vi.fn(),
  },
}));

import { authClient } from '../../lib/auth-client';
import { useAuth } from '../useAuth';
import { AuthProvider } from '../../contexts/AuthContext';

const mockedGetSession = vi.mocked(authClient.getSession);

beforeEach(() => {
  mockedGetSession.mockReset();
});

describe('useAuth', () => {
  it('異常系: AuthProvider の外で呼ぶとエラーを投げる', () => {
    // renderHook の中で throw されたエラーは外側に伝播する
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    );
  });

  it('正常系: 未ログイン状態では user が null', async () => {
    mockedGetSession.mockResolvedValue({ data: null } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(typeof result.current.logout).toBe('function');
  });

  it('正常系: セッションがあれば User オブジェクトを返す', async () => {
    mockedGetSession.mockResolvedValue({
      data: {
        user: {
          id: '42',
          name: 'Alice',
          email: 'alice@example.com',
          image: 'http://example.com/a.png',
        },
      },
    } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual({
      id: 42,
      name: 'Alice',
      email: 'alice@example.com',
      avatar_url: 'http://example.com/a.png',
    });
  });

  it('異常系: getSession が reject したら user は null', async () => {
    mockedGetSession.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });
});
