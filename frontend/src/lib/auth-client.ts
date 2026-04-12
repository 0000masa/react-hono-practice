import { createAuthClient } from 'better-auth/react';

const baseURL = import.meta.env.VITE_API_BASE_URL;

export const authClient = createAuthClient({
  baseURL: baseURL ? baseURL.replace(/\/api$/, '') : '',
  basePath: '/api/auth',
});
