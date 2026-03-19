import type { InferSelectModel } from 'drizzle-orm';
import type { users, qrCodes, sessions } from '../db/schema.js';

export type User = InferSelectModel<typeof users>;
export type QrCode = InferSelectModel<typeof qrCodes>;
export type Session = InferSelectModel<typeof sessions>;

export type SessionData = {
  userId?: number;
  [key: string]: unknown;
};

export type Env = {
  Variables: {
    session: SessionData;
    sessionId: string;
    sessionChanged: boolean;
    user: User;
  };
};

export type PaginationMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
};
