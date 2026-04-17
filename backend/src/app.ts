import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return getAuth().handler(c.req.raw);
});

app.route('/api', api);

app.onError((err, c) => {
  logError('ERROR', 'api', 'Unhandled error in API handler', err, {
    path: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
