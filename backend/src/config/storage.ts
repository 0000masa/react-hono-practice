import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { env } from './env';

export const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    console.log(`Bucket "${env.S3_BUCKET}" already exists.`);
  } catch {
    console.log(`Creating bucket "${env.S3_BUCKET}"...`);
    await s3Client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));

    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicRead',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${env.S3_BUCKET}/*`],
        },
      ],
    };

    await s3Client.send(
      new PutBucketPolicyCommand({
        Bucket: env.S3_BUCKET,
        Policy: JSON.stringify(policy),
      })
    );

    console.log(`Bucket "${env.S3_BUCKET}" created with public read policy.`);
  }
}
