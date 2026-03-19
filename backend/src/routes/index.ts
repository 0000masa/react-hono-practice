import { Hono } from 'hono';
import auth from './auth.js';
import usersRoute from './users.js';
import qrcodes from './qrcodes.js';
import mail from './mail.js';
import health from './health.js';
import type { Env } from '../types/index.js';

const api = new Hono<Env>();

api.route('/auth', auth);
api.route('/users', usersRoute);
api.route('/qrcodes', qrcodes);
api.route('/mail', mail);
api.route('/health', health);

export default api;
