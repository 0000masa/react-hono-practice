import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './config/env';
import { getAuth } from './config/auth';
import api from './routes/index';
import type { Env } from './types/index';

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

export default app;
