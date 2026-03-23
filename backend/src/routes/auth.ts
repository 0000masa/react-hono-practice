import { Hono } from 'hono';
import { redirectToGoogle, handleGoogleCallback, getUser, logout } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';
import type { Env } from '../types/index';

const auth = new Hono<Env>();

auth.get('/google', redirectToGoogle);
auth.get('/google/callback', handleGoogleCallback);

auth.get('/user', authMiddleware, getUser);
auth.post('/logout', authMiddleware, logout);

export default auth;
