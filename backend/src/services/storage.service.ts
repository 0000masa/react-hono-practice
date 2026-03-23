import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/storage';
import { env } from '../config/env';

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export function getFileUrl(fileName: string): string {
  return `${env.STORAGE_URL_BASE}/${fileName}`;
}
