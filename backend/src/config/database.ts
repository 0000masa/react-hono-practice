import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { env } from './env';
import * as schema from '../db/schema';

const pool = mysql.createPool({
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  database: env.DATABASE_NAME,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
});

export const db = drizzle(pool, { schema, mode: 'default' });
export { pool };
