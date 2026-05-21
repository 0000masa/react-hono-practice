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
// ところが QRCode.toBuffer はオーバーロード (= 同じ関数名に対して複数の
// 型シグネチャが宣言されている状態) のため、`vi.mocked()` に素のまま渡すと
// 自動で選ばれる overload が callback 版 (戻り値 void) 寄りになり、
// `mockResolvedValue(Buffer)` の引数型が合わなくなる。
//
// 対策: `vi.mocked` に渡す前に "Promise<Buffer> を返す関数" として
// キャストしておき、overload を 1 本に絞り込む。これにより以降の
// `mockResolvedValue` / `mock.calls` の型推論が安定する。
//
// uploadFile 側はオーバーロードが無いので、普通の `vi.mocked()` だけで OK。
const mockedToBuffer = vi.mocked(
  QRCode.toBuffer as (data: string, options?: object) => Promise<Buffer>,
);
const mockedUploadFile = vi.mocked(uploadFile);

describe('generateAndUpload', () => {
  // 各テストの直前で、両モックを「成功時のデフォルト挙動」にリセットする。
  //
  // ・mockedToBuffer.mockResolvedValue(Buffer.from('png-bytes'))
  //     `QRCode.toBuffer` が呼ばれたら、Buffer.from('png-bytes') を中身に持つ
  //     Promise を返すように設定。
  //
  //     ─── Buffer とは ───────────────────────────────────────────
  //     `Buffer` は Node.js が標準で用意している「バイト列 (バイナリデータ)
  //     を扱うためのクラス」。import 不要でグローバルに使える組み込み API。
  //     (ブラウザの JavaScript には存在しない Node 固有のもの。後から
  //      標準化された Uint8Array / ArrayBuffer と互換で、現在の Buffer は
  //      Uint8Array を継承している。)
  //     ─────────────────────────────────────────────────────────────
  //
  //     `Buffer.from(string)` は「文字列を UTF-8 バイト列に変換した Buffer
  //     オブジェクト」を作るファクトリ関数。
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

    // --- アサーション 1: toBuffer の呼び出し引数を検証 ---
    // `toHaveBeenCalledWith(...期待引数)` は、対象のモック関数が指定した
    // 引数で呼ばれたかを検証するマッチャ。各引数は内部的に深い等価比較
    // (`expect.equals` 相当) で照合される。
    //
    // ここで確認していること:
    //   - 第 1 引数が 'hello'
    //       → generateAndUpload に渡したテキストが、そのまま toBuffer に
    //         中継されているか (配管が正しいか) を見ている。
    //   - 第 2 引数が { type: 'png', width: 300, margin: 1 }
    //       → qrcode.service.ts でハードコードしているオプション値そのもの。
    //
    // この検証によって「generateAndUpload は受け取ったテキストを toBuffer に
    // 渡し、決まったオプションを付ける」という関数の契約 (contract) が固定
    // される。後でオプション値をうっかり変えてしまうとこのテストが落ちて
    // 気づける = 仕様の回帰防止になる。
    expect(mockedToBuffer).toHaveBeenCalledWith('hello', {
      type: 'png',
      width: 300,
      margin: 1,
    });

    // --- アサーション 2: uploadFile が「ちょうど 1 回」呼ばれたか ---
    // `toHaveBeenCalledOnce()` はモックが **ぴったり 1 回** 呼ばれたことを
    // 検証する糖衣マッチャ (`toHaveBeenCalledTimes(1)` と同じ意味)。
    //
    // なぜ「1 回」を明示的に固定するか:
    //   ・0 回    → アップロード処理に到達していない (バグ: 早期 return など)
    //   ・2 回以上 → ループ / 再試行で重複アップロード (バグ: 課金や容量に影響)
    //   どちらも具合が悪いので、回数まで含めて契約として固定する。
    //
    // このテストでは「呼び出し回数」だけを見ている。引数の中身は次の it
    // (「uploadFile に toBuffer の戻り値…」) で別途検証している。
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
