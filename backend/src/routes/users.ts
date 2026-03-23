import { Hono } from 'hono';
import { index } from '../controllers/users.controller';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types/index';

const usersRoute = new Hono<Env>();

usersRoute.get('/', authMiddleware, index);

export default usersRoute;
