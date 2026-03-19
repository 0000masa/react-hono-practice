import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  bigint,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }),
  googleId: varchar('google_id', { length: 255 }).unique(),
  avatarUrl: varchar('avatar_url', { length: 255 }),
  emailVerifiedAt: timestamp('email_verified_at'),
  rememberToken: varchar('remember_token', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  qrCodes: many(qrCodes),
}));

export const qrCodes = mysqlTable('qr_codes', {
  id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull().default(''),
  data: text('data'),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
});

export const qrCodesRelations = relations(qrCodes, ({ one }) => ({
  user: one(users, {
    fields: [qrCodes.userId],
    references: [users.id],
  }),
}));

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  payload: text('payload'),
  lastActivity: int('last_activity').notNull(),
});
