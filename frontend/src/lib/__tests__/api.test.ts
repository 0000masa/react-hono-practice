import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import apiClient from '../api';

// jsdom の window.location は通常 read-only。テストでパスや遷移を制御するため上書きする。
const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname: '/', href: '/' },
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
});

describe('apiClient.get', () => {
  it('正常系: クエリパラメータを URL に組み込む', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [] }),
    });

    const res = await apiClient.get('/users', { params: { page: 1, sort: 'name' } });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users?page=1&sort=name');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  it('正常系: params が空のときは ? が付かない', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiClient.get('/users');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/users');
  });
});

describe('apiClient.post', () => {
  it('正常系: JSON body と Content-Type を付けて送信する', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
    });

    await apiClient.post('/users', { name: 'Alice' });

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ name: 'Alice' }));
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(opts.credentials).toBe('include');
  });
});

describe('401 ハンドリング', () => {
  it('異常系: /login 以外で 401 を受け取ったら /login にリダイレクトする', async () => {
    (window.location as unknown as { pathname: string }).pathname = '/dashboard';

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);
    expect(window.location.href).toBe('/login');
  });

  it('異常系: /login 自身で 401 を受け取ってもリダイレクトしない (ループ防止)', async () => {
    (window.location as unknown as { pathname: string }).pathname = '/login';

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);
    expect(window.location.href).toBe('/');
  });

  it('異常系: 500 エラーは ApiError として throw される', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(apiClient.get('/users')).rejects.toThrow(/status 500/);
    expect(window.location.href).toBe('/'); // リダイレクトは 401 だけ
  });
});
