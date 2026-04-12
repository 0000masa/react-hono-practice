import type { InferSelectModel } from 'drizzle-orm';
import type { users, qrCodes, sessions } from '../db/schema';

export type User = InferSelectModel<typeof users>;
export type QrCode = InferSelectModel<typeof qrCodes>;
export type Session = InferSelectModel<typeof sessions>;

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Env = {
  Variables: {
    user: AuthUser;
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
