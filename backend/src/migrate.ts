import path from 'node:path';
import { initDatabase, db } from './config/database';
import { migrate } from 'drizzle-orm/mysql2/migrator';

const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;

  const migrationsFolder = path.join(__dirname, 'db', 'migrations');
  await migrate(db, { migrationsFolder });

  console.log('Migration completed successfully');
  return { statusCode: 200, body: 'Migration completed' };
};
