import { eq, and, gte, lt, count } from 'drizzle-orm';
import { initDatabase, db } from './config/database';
import { qrCodes, users } from './db/schema';
import { sendMail } from './services/mail.service';

const dbReady = initDatabase();

export const handler = async () => {
  await dbReady;

  // 前日の期間を JST（UTC+9）ベースで算出し、UTC に変換
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstYesterday = new Date(jstNow);
  jstYesterday.setDate(jstYesterday.getDate() - 1);

  const startOfDayJST = new Date(
    jstYesterday.getFullYear(),
    jstYesterday.getMonth(),
    jstYesterday.getDate(),
  );
  const endOfDayJST = new Date(
    jstYesterday.getFullYear(),
    jstYesterday.getMonth(),
    jstYesterday.getDate() + 1,
  );

  // JST → UTC
  const startUTC = new Date(startOfDayJST.getTime() - 9 * 60 * 60 * 1000);
  const endUTC = new Date(endOfDayJST.getTime() - 9 * 60 * 60 * 1000);

  // ユーザーごとの QR コード生成数を集計
  const perUserStats = await db
    .select({
      userId: qrCodes.userId,
      userName: users.name,
      userEmail: users.email,
      count: count(),
    })
    .from(qrCodes)
    .leftJoin(users, eq(qrCodes.userId, users.id))
    .where(and(gte(qrCodes.createdAt, startUTC), lt(qrCodes.createdAt, endUTC)))
    .groupBy(qrCodes.userId, users.name, users.email);

  // 全体サマリー
  const totalQrCodes = perUserStats.reduce((sum, row) => sum + row.count, 0);
  const activeUserCount = perUserStats.length;
  const sortedStats = [...perUserStats].sort((a, b) => b.count - a.count);
  const mostActive = sortedStats[0] ?? null;

  // 日付フォーマット（JST）
  const dateStr = `${jstYesterday.getFullYear()}/${String(jstYesterday.getMonth() + 1).padStart(2, '0')}/${String(jstYesterday.getDate()).padStart(2, '0')}`;

  // 全ユーザーを取得
  const allUsers = await db.select().from(users);

  // ユーザーごとの生成数マップ
  const userCountMap = new Map(
    perUserStats.map((row) => [row.userId, row.count]),
  );

  // 各ユーザーに個別メール送信
  const subject = `【日次レポート】${dateStr} QRコード生成サマリー`;

  for (const user of allUsers) {
    const userCount = userCountMap.get(user.id) ?? 0;

    const body = `
      <h3>${dateStr} のQRコード生成レポート</h3>
      <h4>あなたのアクティビティ</h4>
      <p>QRコード生成数: <strong>${userCount}件</strong></p>
      <h4>全体サマリー</h4>
      <ul>
        <li>総QRコード生成数: ${totalQrCodes}件</li>
        <li>アクティブユーザー数: ${activeUserCount} / ${allUsers.length}人</li>
        ${mostActive ? `<li>最もアクティブなユーザー: ${mostActive.userName ?? 'Unknown'} (${mostActive.count}件)</li>` : ''}
      </ul>
    `;

    try {
      await sendMail(user.email, subject, body);
    } catch (error) {
      console.error(`Failed to send daily report to ${user.email}:`, error);
    }
  }

  console.log(`Daily report sent to ${allUsers.length} users`);
  return { statusCode: 200, body: `Report sent to ${allUsers.length} users` };
};
