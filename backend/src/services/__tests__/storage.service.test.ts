import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadFile, getFileUrl } from '../storage.service';
import { env } from '../../config/env';

const s3Mock = mockClient(S3Client);

describe('uploadFile', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it('正常系: PutObjectCommand を期待した引数で S3 に送信する', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const buf = Buffer.from('hello-png');
    await uploadFile('user-1/image.png', buf, 'image/png');

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      Bucket: env.S3_BUCKET,
      Key: 'user-1/image.png',
      Body: buf,
      ContentType: 'image/png',
    });
  });

  it('異常系: S3 が reject したら同じエラーを伝播する', async () => {
    s3Mock.on(PutObjectCommand).rejects(new Error('S3 unavailable'));

    await expect(
      uploadFile('k', Buffer.from(''), 'image/png'),
    ).rejects.toThrow('S3 unavailable');
  });
});

describe('getFileUrl', () => {
  it('STORAGE_URL_BASE とファイル名を `/` で結合する', () => {
    expect(getFileUrl('abc.png')).toBe(`${env.STORAGE_URL_BASE}/abc.png`);
  });

  it('ファイル名にパス区切りが含まれてもそのまま結合する', () => {
    expect(getFileUrl('1/x.png')).toBe(`${env.STORAGE_URL_BASE}/1/x.png`);
  });
});
