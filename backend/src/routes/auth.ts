import { Hono } from 'hono';
import { redirectToGoogle, handleGoogleCallback, getUser, logout } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../types/index.js';

const auth = new Hono<Env>();

auth.get('/google', redirectToGoogle);
auth.get('/google/callback', handleGoogleCallback);

auth.get('/user', authMiddleware, getUser);
auth.post('/logout', authMiddleware, logout);

export default auth;
