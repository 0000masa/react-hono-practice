import { Hono } from 'hono';
import { send } from '../controllers/mail.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../types/index.js';

const mail = new Hono<Env>();

mail.post('/send', authMiddleware, send);

export default mail;
