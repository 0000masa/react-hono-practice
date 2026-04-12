import { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { env } from './env';

// 本番（Lambda）: IAM ロール認証 + S3 デフォルトエンドポイント
// 開発（ローカル）: MinIO に接続するため endpoint / credentials / forcePathStyle を指定
export const s3Client = new S3Client(
  env.S3_ENDPOINT
    ? {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
        // パス形式を有効化（MinIO は仮想ホスト形式に非対応のため必要）
        // true:  https://minio:9000/bucket-name/key（パス形式）
        // false: https://bucket-name.s3.region.amazonaws.com/key（仮想ホスト形式、AWS S3 デフォルト）
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      }
    : {
        region: env.S3_REGION,
      },
);

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
