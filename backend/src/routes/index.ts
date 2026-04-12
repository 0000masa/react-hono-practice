import { Hono } from 'hono';
import usersRoute from './users';
import qrcodes from './qrcodes';
import mail from './mail';
import health from './health';
import type { Env } from '../types/index';

const api = new Hono<Env>();

api.route('/users', usersRoute);
api.route('/qrcodes', qrcodes);
api.route('/mail', mail);
api.route('/health', health);

export default api;
