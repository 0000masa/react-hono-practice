import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? 'mysql',
    port: parseInt(process.env.DATABASE_PORT ?? '3306', 10),
    database: process.env.DATABASE_NAME ?? 'database',
    user: process.env.DATABASE_USER ?? 'user',
    password: process.env.DATABASE_PASSWORD ?? 'password',
  },
});
