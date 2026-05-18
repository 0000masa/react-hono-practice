import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { env } from './config/env';
import { getAuth } from './config/auth';
import api from './routes/index';
import type { Env } from './types/index';
import { logError } from './utils/logger';

const app = new Hono<Env>();

app.use('*', logger());

app.use(
  '/api/*',
  cors({
    origin: env.FRONTEND_URL,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    credentials: true,
  }),
);

// Better Auth は自前で Response を組み立てて返す (throw しない) ため、
// onError では拾えない。ここで status を見て 5xx だけ logError に流す。
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const res = await getAuth().handler(c.req.raw);
  if (res.status >= 500) {
    logError('ERROR', 'api', `Better Auth returned ${res.status}`, undefined, {
      path: c.req.path,
      method: c.req.method,
      status: res.status,
    });
  }
  return res;
});

app.route('/api', api);

// 集中エラーハンドリング:
//   - HTTPException (controller / middleware から throw): status >= 500 のみ logError
//   - それ以外の throw (バグ等): 常に logError
//   - 4xx は通常運用なので通知対象外 (ログも出さない)
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    if (err.status >= 500) {
      logError(
        'ERROR',
        'api',
        err.message || `HTTPException ${err.status}`,
        err.cause ?? err,
        {
          path: c.req.path,
          method: c.req.method,
          status: err.status,
        },
      );
    }
    return err.getResponse();
  }

  logError('ERROR', 'api', 'Unhandled error in API handler', err, {
    path: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
