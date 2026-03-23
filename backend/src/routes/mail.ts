import { Hono } from 'hono';
import { send } from '../controllers/mail.controller';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types/index';

const mail = new Hono<Env>();

mail.post('/send', authMiddleware, send);

export default mail;
