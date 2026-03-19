import { Hono } from 'hono';
import { index, store, storeAsync, status } from '../controllers/qrcodes.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../types/index.js';

const qrcodes = new Hono<Env>();

qrcodes.use('*', authMiddleware);

qrcodes.get('/', index);
qrcodes.post('/', store);
qrcodes.post('/async', storeAsync);
qrcodes.get('/:id/status', status);

export default qrcodes;
