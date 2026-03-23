import { Hono } from 'hono';
import { index, store, storeAsync, status } from '../controllers/qrcodes.controller';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types/index';

const qrcodes = new Hono<Env>();

qrcodes.use('*', authMiddleware);

qrcodes.get('/', index);
qrcodes.post('/', store);
qrcodes.post('/async', storeAsync);
qrcodes.get('/:id/status', status);

export default qrcodes;
