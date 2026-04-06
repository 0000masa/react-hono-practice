import { eq } from 'drizzle-orm';
import { initDatabase, db } from './config/database';
import { qrCodes } from './db/schema';
import { generateAndUpload } from './services/qrcode.service';

const dbReady = initDatabase();

export const handler = async (event: any) => {
  await dbReady;

  for (const record of event.Records) {
    const { qrCodeId, data, userId } = JSON.parse(record.body) as {
      qrCodeId: number;
      data: string;
      userId: number;
    };

    try {
      const fileName = await generateAndUpload(data, userId);
      await db
        .update(qrCodes)
        .set({ fileName, status: 'completed' })
        .where(eq(qrCodes.id, qrCodeId));
      console.log(`QR code ${qrCodeId} generated successfully`);
    } catch (error) {
      console.error(`QR code ${qrCodeId} generation failed:`, error);
      await db
        .update(qrCodes)
        .set({ status: 'failed' })
        .where(eq(qrCodes.id, qrCodeId));
    }
  }

  return { statusCode: 200 };
};
