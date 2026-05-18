import { type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../schema';

// 動作確認用の最小 seeder。冪等にするため onDuplicateKeyUpdate で email 一意制約を吸収する。
// 実データ投入時は本ファイルを置き換えるか、別ファイルを追加して index.ts に登録する。
export default async function seed(db: MySql2Database<typeof schema>): Promise<void> {
  await db
    .insert(schema.users)
    .values({
      name: 'seed-example',
      email: 'seed-example@example.com',
      emailVerified: false,
    })
    .onDuplicateKeyUpdate({ set: { name: 'seed-example' } });
}
