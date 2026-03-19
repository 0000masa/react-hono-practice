import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './config/env.js';
import { sessionMiddleware } from './middleware/session.js';
import api from './routes/index.js';
import type { Env } from './types/index.js';

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
