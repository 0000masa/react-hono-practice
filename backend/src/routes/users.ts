import { Hono } from 'hono';
import { index } from '../controllers/users.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../types/index.js';

const usersRoute = new Hono<Env>();

usersRoute.get('/', authMiddleware, index);

export default usersRoute;
