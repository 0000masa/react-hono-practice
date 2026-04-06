import type { Context } from 'hono';
import { desc, count, eq } from 'drizzle-orm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { db } from '../config/database';
import { qrCodes, users } from '../db/schema';
import { generateAndUpload } from '../services/qrcode.service';
import { getFileUrl } from '../services/storage.service';
import { env } from '../config/env';
import type { Env, PaginationMeta } from '../types/index';

const sqsClient = env.SQS_QUEUE_URL ? new SQSClient({}) : null;

const PER_PAGE = 50;

export async function index(c: Context<Env>) {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const offset = (page - 1) * PER_PAGE;

  const [totalResult] = await db.select({ count: count() }).from(qrCodes);
  const total = totalResult.count;

  const rows = await db
    .select({
      id: qrCodes.id,
      userId: qrCodes.userId,
      fileName: qrCodes.fileName,
      data: qrCodes.data,
      status: qrCodes.status,
      createdAt: qrCodes.createdAt,
      updatedAt: qrCodes.updatedAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(qrCodes)
    .leftJoin(users, eq(qrCodes.userId, users.id))
    .orderBy(desc(qrCodes.createdAt))
    .limit(PER_PAGE)
    .offset(offset);

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total > 0 ? offset + 1 : null;
  const to = total > 0 ? Math.min(offset + PER_PAGE, total) : null;

  const pagination: PaginationMeta = {
    current_page: page,
    last_page: lastPage,
    per_page: PER_PAGE,
    total,
    from,
    to,
  };

  return c.json({
    qrcodes: rows.map((row) => ({
      id: row.id,
      user_id: row.userId,
      user: {
        id: row.userId,
        name: row.userName,
        email: row.userEmail,
      },
      file_name: row.fileName,
      url: row.fileName ? getFileUrl(row.fileName) : null,
      data: row.data,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    })),
    pagination,
  });
}

export async function store(c: Context<Env>) {
  const body = await c.req.json<{ data?: string }>();

  const errors: Record<string, string[]> = {};
  if (!body.data || typeof body.data !== 'string') {
    errors['data'] = ['data は必須です'];
  } else if (body.data.length > 1000) {
    errors['data'] = ['data は1000文字以下で入力してください'];
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: 'バリデーションエラー', messages: errors }, 422);
  }

  const user = c.get('user');

  try {
    const fileName = await generateAndUpload(body.data!, user.id);

    const [result] = await db.insert(qrCodes).values({
      userId: user.id,
      fileName,
      data: body.data!,
      status: 'completed',
    }).$returningId();

    const [qrCode] = await db
      .select()
      .from(qrCodes)
      .where(eq(qrCodes.id, result.id))
      .limit(1);

    return c.json(
      {
        message: 'QRコードを生成しました',
        qrcode: {
          id: qrCode.id,
          user_id: qrCode.userId,
          file_name: qrCode.fileName,
          data: qrCode.data,
          status: qrCode.status,
          created_at: qrCode.createdAt,
          updated_at: qrCode.updatedAt,
          url: getFileUrl(qrCode.fileName),
        },
      },
      201,
    );
  } catch (error) {
    console.error('QR code generation error:', error);
    return c.json(
      {
        error: 'QRコードの生成に失敗しました',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
}

export async function storeAsync(c: Context<Env>) {
  const body = await c.req.json<{ data?: string }>();

  const errors: Record<string, string[]> = {};
  if (!body.data || typeof body.data !== 'string') {
    errors['data'] = ['data は必須です'];
  } else if (body.data.length > 1000) {
    errors['data'] = ['data は1000文字以下で入力してください'];
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: 'バリデーションエラー', messages: errors }, 422);
  }

  const user = c.get('user');

  const [result] = await db.insert(qrCodes).values({
    userId: user.id,
    fileName: '',
    data: body.data!,
    status: 'pending',
  }).$returningId();

  if (sqsClient && env.SQS_QUEUE_URL) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify({
          qrCodeId: result.id,
          data: body.data!,
          userId: user.id,
        }),
      }),
    );
  } else {
    // ローカル開発: SQS なしで直接処理
    (async () => {
      try {
        const fileName = await generateAndUpload(body.data!, user.id);
        await db
          .update(qrCodes)
          .set({ fileName, status: 'completed' })
          .where(eq(qrCodes.id, result.id));
      } catch (error) {
        console.error('Async QR code generation error:', error);
        await db
          .update(qrCodes)
          .set({ status: 'failed' })
          .where(eq(qrCodes.id, result.id));
      }
    })();
  }

  return c.json(
    {
      message: 'QRコード生成ジョブをキューに投入しました',
      qrcode: {
        id: result.id,
        status: 'pending',
        data: body.data!,
        created_at: new Date(),
      },
    },
    202,
  );
}

export async function status(c: Context<Env>) {
  const id = parseInt(c.req.param('id') ?? '0', 10);

  const [qrCode] = await db
    .select()
    .from(qrCodes)
    .where(eq(qrCodes.id, id))
    .limit(1);

  if (!qrCode) {
    return c.json({ error: 'QRコードが見つかりません' }, 404);
  }

  const response: Record<string, unknown> = {
    id: qrCode.id,
    status: qrCode.status,
    data: qrCode.data,
    created_at: qrCode.createdAt,
    updated_at: qrCode.updatedAt,
  };

  if (qrCode.status === 'completed' && qrCode.fileName) {
    response.url = getFileUrl(qrCode.fileName);
    response.file_name = qrCode.fileName;
  }

  return c.json(response);
}
