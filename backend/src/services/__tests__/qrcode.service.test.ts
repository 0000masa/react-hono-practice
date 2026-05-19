import { describe, it, expect, vi, beforeEach } from 'vitest';

// QRCode.toBuffer はオーバーロードが多く、`vi.fn()` だけでは戻り型推論が
// void 寄りになるため、Promise<Buffer> を明示する。
vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn<(data: string, options?: object) => Promise<Buffer>>(),
  },
}));

vi.mock('../storage.service', () => ({
  uploadFile: vi.fn(),
}));

import QRCode from 'qrcode';
import { uploadFile } from '../storage.service';
import { generateAndUpload } from '../qrcode.service';

// QRCode.toBuffer はオーバーロードのため、vi.mocked の戻り型が
// callback 版 (void) に推論されてしまう。Promise<Buffer> 版として扱う。
const mockedToBuffer = vi.mocked(QRCode.toBuffer) as unknown as ReturnType<
  typeof vi.fn<(data: string, options?: object) => Promise<Buffer>>
>;
const mockedUploadFile = vi.mocked(uploadFile);

describe('generateAndUpload', () => {
  beforeEach(() => {
    mockedToBuffer.mockResolvedValue(Buffer.from('png-bytes'));
    mockedUploadFile.mockResolvedValue(undefined);
  });

  it('QR を生成して S3 にアップロードし、ファイル名を返す', async () => {
    const fileName = await generateAndUpload('hello', 42);

    expect(mockedToBuffer).toHaveBeenCalledWith('hello', {
      type: 'png',
      width: 300,
      margin: 1,
    });
    expect(mockedUploadFile).toHaveBeenCalledOnce();

    // {userId}_{unix_timestamp}_{8文字の hex}.png 形式
    expect(fileName).toMatch(/^42_\d+_[0-9a-f]{8}\.png$/);
  });

  it('uploadFile に toBuffer の戻り値 (Buffer) と image/png が渡される', async () => {
    const buf = Buffer.from('mock-buffer-contents');
    mockedToBuffer.mockResolvedValue(buf);

    const fileName = await generateAndUpload('data', 1);

    expect(mockedUploadFile).toHaveBeenCalledWith(fileName, buf, 'image/png');
  });

  it('QR ライブラリがエラーを投げたら呼び出し元へ伝播し、S3 へはアップロードしない', async () => {
    mockedToBuffer.mockRejectedValue(new Error('QR encoding failed'));

    await expect(generateAndUpload('hello', 1)).rejects.toThrow('QR encoding failed');
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });
});
