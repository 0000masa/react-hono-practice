import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './config/env';
import { sessionMiddleware } from './middleware/session';
import api from './routes/index';
import type { Env } from './types/index';

const app = new Hono<Env>();

app.use('*', logger());

app.use(
  '/api/*',
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

app.use('/api/*', sessionMiddleware);

app.route('/api', api);

export default app;
