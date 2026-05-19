import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createAuthMock, setSessionUser, TEST_USER } from '../helpers/auth';
import { cleanupDb } from '../helpers/db';

vi.mock('../../config/auth', () => createAuthMock());

import app from '../../app';
import { db, pool } from '../../config/database';
import { users } from '../../db/schema';

const s3Mock = mockClient(S3Client);

beforeEach(async () => {
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  await cleanupDb();
  setSessionUser(TEST_USER);
  await db.insert(users).values({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerified: TEST_USER.emailVerified,
    image: TEST_USER.image,
  });
});

afterAll(async () => {
  await pool?.end();
});

describe('E2E: ログイン済みユーザーが QR コードを作成して一覧で取得できる', () => {
  it('ハッピーパス: POST /api/qrcodes → GET /api/qrcodes で作成済み QR が含まれる', async () => {
    // 1. QR コード作成
    const created = await app.request('/api/qrcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'https://example.com' }),
    });
    expect(created.status).toBe(201);

    // 2. 一覧取得
    const listed = await app.request('/api/qrcodes');
    expect(listed.status).toBe(200);

    const body = (await listed.json()) as {
      qrcodes: Array<{
        data: string;
        user: { name: string };
        url: string | null;
      }>;
    };

    expect(body.qrcodes).toHaveLength(1);
    expect(body.qrcodes[0].data).toBe('https://example.com');
    expect(body.qrcodes[0].user.name).toBe(TEST_USER.name);
    expect(body.qrcodes[0].url).toContain(process.env.STORAGE_URL_BASE!);
  });
});
