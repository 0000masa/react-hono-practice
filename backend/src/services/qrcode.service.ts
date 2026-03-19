import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { uploadFile } from './storage.service.js';

export async function generateAndUpload(
  data: string,
  userId: number,
): Promise<string> {
  const buffer = await QRCode.toBuffer(data, {
    type: 'png',
    width: 300,
    margin: 1,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const uniqId = crypto.randomBytes(4).toString('hex');
  const fileName = `${userId}_${timestamp}_${uniqId}.png`;

  await uploadFile(fileName, buffer, 'image/png');

  return fileName;
}
