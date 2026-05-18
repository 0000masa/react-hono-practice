import { type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../schema';
import seed_0001_example from './0001_example';

// esbuild は動的 import + glob を解決できないため、seeder は静的 import で登録する。
// 新規 seeder を追加するときは、本ファイルの import 行と seeders の両方にエントリを足す。
type DB = MySql2Database<typeof schema>;
export type Seeder = (db: DB) => Promise<void>;

export const seeders: Record<string, Seeder> = {
  '0001_example': seed_0001_example,
};
