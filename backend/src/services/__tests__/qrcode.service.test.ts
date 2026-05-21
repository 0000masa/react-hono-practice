/**
 * qrcode.service.ts のユニットテスト。
 *
 * 何をテストしているか:
 *   `generateAndUpload(data, userId)` (src/services/qrcode.service.ts) について、
 *     1. `QRCode.toBuffer` に正しいオプションが渡され、戻り値のファイル名が規約通りか
 *     2. `toBuffer` の戻り値 (Buffer) と 'image/png' がそのまま `uploadFile` に渡るか
 *     3. QR ライブラリがエラーを投げたら呼び出し元へ伝播し、かつ S3 アップロードは
 *        されない (= 中途半端な状態を残さない) か
 *   の 3 点を検証する。
 *   実際の QR 生成 / S3 アップロードはどちらも行わない (両方モック化するため)。
 *
 * いつ実行されるか: `*.test.ts` のユニットテスト扱い → `npm test` で走る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock('qrcode', factory)` で npm パッケージ "qrcode" を丸ごとモックに差し替え。
//
// 第 1 引数 `'qrcode'`:
//   npm パッケージ名 (QR コード生成ライブラリ)。
//   `import QRCode from 'qrcode'` の `'qrcode'` と同じ書き方を渡す。
//
// 第 2 引数 (factory) の中の `default:`:
//   ESM のデフォルト export を表す。
//   本物の qrcode は `export default { toBuffer, toString, ... }` のような形で
//   default export を出しているので、`import QRCode from 'qrcode'` (中括弧なし)
//   はこの default を取り出す書き方になる。
//   モック側もそれと同じ構造 (`default: { ... }`) を返す必要がある。
//
// `toBuffer`:
//   qrcode が提供するメソッドの 1 つで、文字列を受け取って PNG バイト列
//   (Buffer) の Promise を返す関数。`generateAndUpload` の中で
//   `await QRCode.toBuffer(data, { type: 'png', ... })` として呼ばれている。
//
// `vi.fn<(data: string, options?: object) => Promise<Buffer>>()`:
//   `vi.fn()` に型引数でシグネチャを明示している。理由は、
//   本物の toBuffer は callback 版 (戻り値 void) と Promise 版の
//   オーバーロードを持っているため、何も指定しないと型推論が callback 版を
//   選んでしまい、`mockResolvedValue(Buffer)` の引数型が `void` になって
//   コンパイルエラーになる — それを防ぐ目的の型注釈。
vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn<(data: string, options?: object) => Promise<Buffer>>(),
  },
}));

// storage.service モジュールも丸ごと差し替えて、`uploadFile` を vi.fn() に。
// → 実際の S3 (AWS) には絶対に到達しない。
vi.mock('../storage.service', () => ({
  uploadFile: vi.fn(),
}));

import QRCode from 'qrcode';
import { uploadFile } from '../storage.service';
import { generateAndUpload } from '../qrcode.service';

// `vi.mocked()` で「これはモック関数です」という型情報を付け直す。
// `vi.mocked` は実行時は何もしない型キャスト用ユーティリティ (= as キャストの
// ヘルパ)。実体としての差し替えは上の `vi.mock('qrcode', ...)` が既に
// 済ませている前提。
//
// ところが QRCode.toBuffer はオーバーロードのため、`vi.mocked` が
// 自動で付ける型はオーバーロード集合のうち callback 版 (戻り値 void) 寄りに
// 選ばれてしまい、`mockResolvedValue(Buffer)` の引数型が合わなくなる。
// そこで明示的に "Promise<Buffer> を返すモック" の型へキャストし直している:
//
//   `as unknown as X`
//     → TypeScript は「型が全く違うもの」への直接の `as X` を拒否する。
//        いったん `unknown` を経由する慣用句 (ダブルキャスト) で
//        強制的にキャストしている。
//   `ReturnType<typeof vi.fn<(...) => Promise<Buffer>>>`
//     → 「`vi.fn<(...) => Promise<Buffer>>()` を呼び出したときの返り値の型」
//        の意。実体は MockedFunction 相当 (mockResolvedValue / mock.calls
//        などモック専用メソッドが生える型) を Promise<Buffer> 版で取得する。
//
// uploadFile 側はオーバーロードが無いので、普通の `vi.mocked()` だけで OK。
const mockedToBuffer = vi.mocked(QRCode.toBuffer) as unknown as ReturnType<
  typeof vi.fn<(data: string, options?: object) => Promise<Buffer>>
>;
const mockedUploadFile = vi.mocked(uploadFile);

describe('generateAndUpload', () => {
  // 各テストの直前で、両モックを「成功時のデフォルト挙動」にリセットする。
  //
  // ・mockedToBuffer.mockResolvedValue(Buffer.from('png-bytes'))
  //     `QRCode.toBuffer` が呼ばれたら、Buffer.from('png-bytes') を中身に持つ
  //     Promise を返すように設定。
  //     `Buffer.from(string)` は「文字列を UTF-8 バイト列に変換した
  //     Node の Buffer オブジェクト」を作る組み込み API。
  //     ここではテスト用のダミーで、本物の PNG バイナリの代用品。中身は
  //     何でも良い (テスト的に意味があるのは "Buffer であること" だけ)。
  //
  // ・mockedUploadFile.mockResolvedValue(undefined)
  //     `uploadFile` は本来 Promise<void> を返す API。
  //     "成功して何も返さない" Promise を返すよう設定 = 実質「黙って成功」。
  //
  // beforeEach に書く意味:
  //   ケース 3 で `mockRejectedValue(...)` に上書きしても、次のテストでは
  //   ここが再度走って「成功状態」に戻る。テスト順への依存を切るため。
  //   (clearMocks: true は呼び出し履歴しか消さず、mockResolvedValue 等の
  //    実装差し替えは残るので、明示的に上書きする必要がある)
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
    // `buf` は「toBuffer が返したことにする値」をこのテスト専用に用意したもの。
    // `Buffer.from('mock-buffer-contents')` で **このテスト固有の中身を持つ
    // Buffer** を作っている (`'mock-buffer-contents'` という文字列は単なる
    // 目印で、本物の PNG バイナリではない)。
    //
    // なぜ beforeEach の 'png-bytes' とは別の Buffer をわざわざ作るか:
    //   下の `toHaveBeenCalledWith(fileName, buf, 'image/png')` で
    //   「**この `buf` が** uploadFile の第 2 引数に **そのまま** 渡ったか」を
    //   厳密に検証したいから。テスト固有の値にすることで、
    //   「toBuffer の戻り値がそのまま uploadFile へ受け渡されているか」
    //   という配管 (parameter passing) を識別可能な形で確認できる。
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
