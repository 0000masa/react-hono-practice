import { db } from '../../config/database';
import { qrCodes, sessions, accounts, verifications, users } from '../../db/schema';

// テスト間でデータが残らないよう、各テスト前に全テーブルをクリーンアップする。
// 外部キーがあるため、子→親の順で削除。
export async function cleanupDb(): Promise<void> {
  await db.delete(qrCodes);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
}
