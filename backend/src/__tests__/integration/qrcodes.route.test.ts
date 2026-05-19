import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createAuthMock, setSessionUser, clearSession, TEST_USER } from '../helpers/auth';
import { cleanupDb } from '../helpers/db';

// authMiddleware が呼ぶ getAuth() を差し替える。
// vi.mock は他の import より先に巻き上げられるため app.ts より上に書く必要がある。
vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db, pool } from '../../config/database';
import { users, qrCodes } from '../../db/schema';

const s3Mock = mockClient(S3Client);

async function insertTestUser() {
  await db.insert(users).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerified: TEST_USER.emailVerified,
    image: TEST_USER.image,
  });
}

beforeEach(async () => {
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  await cleanupDb();
  clearSession();
});

afterAll(async () => {
  await pool?.end();
});

describe('GET /api/qrcodes', () => {
  it('異常系: 認証なしなら 401 を返す', async () => {
    const res = await app.request('/api/qrcodes');
    expect(res.status).toBe(401);
  });

  it('正常系: 認証済みで空のとき 200 + 空配列を返す', async () => {
    setSessionUser(TEST_USER);
    await insertTestUser();

    const res = await app.request('/api/qrcodes');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { qrcodes: unknown[]; pagination: { total: number } };
    expect(body.qrcodes).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });
});

describe('POST /api/qrcodes', () => {
  beforeEach(() => {
    setSessionUser(TEST_USER);
  });

  it('正常系: 201 を返し、DB に 1 件作成され、S3 にアップロードされる', async () => {
    await insertTestUser();

    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hello world' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      qrcode: { data: string; status: string; url: string; file_name: string };
    };
    expect(body.qrcode.data).toBe('hello world');
    expect(body.qrcode.status).toBe('completed');
    expect(body.qrcode.url).toContain(process.env.STORAGE_URL_BASE!);

    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(1);
    expect(stored[0].data).toBe('hello world');
    expect(stored[0].userId).toBe(TEST_USER.id);

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it('異常系: data 未指定なら 422、DB は変わらない', async () => {
    await insertTestUser();

    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
    const stored = await db.select().from(qrCodes);
    expect(stored).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('異常系: data が 1001 文字なら 422 を返す', async () => {
    await insertTestUser();

    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'a'.repeat(1001) }),
    });

    expect(res.status).toBe(422);
  });

  it('異常系: 認証なしなら 401', async () => {
    clearSession();

    const res = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x' }),
    });

    expect(res.status).toBe(401);
  });
});
