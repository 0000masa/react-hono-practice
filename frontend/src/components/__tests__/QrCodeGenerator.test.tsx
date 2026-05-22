// frontend/src/components/__tests__/QrCodeGenerator.test.tsx
//
// このファイルの目的:
//   <QrCodeGenerator /> コンポーネントの「ユーザー視点」での振る舞いを検証する
//   コンポーネントテスト。バックエンドの "結合テスト" に相当する層
//   (詳細: docs/md/test/react-hono-testing-faq.md §3.2)。
//
// 検証する 4 ケース:
//   1. 正常系: テキスト入力 → 送信で apiClient.post が呼ばれ成功メッセージが表示される
//   2. 正常系: 成功時に `qrcode-created` カスタムイベントが発火される
//   3. 異常系: API がエラーを投げたらエラーメッセージが表示される
//   4. 異常系: 空欄ではボタンが disabled で API は呼ばれない
//
// 外部依存の扱い:
//   - apiClient (HTTP 通信) → vi.mock でモジュール丸ごとモック化
//   - DOM 環境 → jsdom (frontend/vitest.config.ts で `environment: 'jsdom'`)
//   - ユーザー操作 → @testing-library/user-event でキーボード/クリックを再現
//   - DOM マッチャ → @testing-library/jest-dom (frontend/src/test/setup.ts で取り込み済み)
//
// なお frontend/vitest.config.ts は `globals: true` を有効にしているため
// describe/it/expect/vi/beforeEach は import しなくても動く。
// ただし本プロジェクトでは「ファイルが何を使っているか import から追える」
// 方を優先して、敢えて明示 import している。

// Vitest 本体: テスト記述 API (describe/it)、アサーション (expect)、
// モック (vi)、ライフサイクルフック (beforeEach) を提供。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// @testing-library/react:
//   render — React コンポーネントを jsdom の DOM に実際にマウントする
//   screen — レンダリング後のドキュメント全体に対するクエリ集 (getByXxx / findByXxx / queryByXxx)
import { render, screen } from '@testing-library/react';

// @testing-library/user-event:
//   ユーザー操作 (タイプ・クリック・タブ移動) を「実際のキーイベント連鎖」で再現するライブラリ。
//   testing-library/react 同梱の fireEvent は合成イベントを 1 個直接 dispatch するだけだが、
//   user-event は keydown → keypress → input → keyup のように人間の操作に近い順序で
//   イベントを発火する。v14 以降は `userEvent.setup()` でインスタンス化する作法。
import userEvent from '@testing-library/user-event';

// ──────────────────────────────────────────────────────────
// apiClient のモジュール丸ごと差し替え
// ──────────────────────────────────────────────────────────
// QrCodeGenerator は `import apiClient from '../lib/api'` で apiClient を読み、
// `apiClient.post('/qrcodes', { data })` を呼ぶ。テストでは本物の HTTP を
// 飛ばしたくないので、モジュールごと vi.mock で差し替える。
//
// factory の戻り値オブジェクトが、その import から見える module の export 形に
// なる。lib/api.ts は `export default apiClient` (default export) なので、
// `default: { get, post, ... }` の形にする必要がある。
//
// vi.mock はファイル冒頭にホイストされる (詳細: docs/md/test/vitest-reference.md §6.3
// および §12.2) ため、import より上に書いても下に書いても効果は同じ。
vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),    // vi.fn() = 「呼ばれた事実を記録するだけの空の関数」
    post: vi.fn(),   // 戻り値はテスト側で mockResolvedValue / mockRejectedValue で仕込む
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// vi.mock のあとに import すると、上で差し替えた版が読まれる。
import apiClient from '../../lib/api';
import QrCodeGenerator from '../QrCodeGenerator';

// vi.mocked(...) はランタイム的には引数をそのまま返すだけのヘルパで、
// TypeScript の型を「これはモック関数だ」と付け直すだけ
// (= mockResolvedValue / mock.calls などの型補完が効くようにする)。
// 詳細: docs/md/test/vitest-reference.md §6.7
const mockedPost = vi.mocked(apiClient.post);

// 各テストの直前に呼ばれる。前のテストで仕込んだ mockResolvedValue や
// 呼び出し履歴 (mock.calls) を 0 にリセットする。
// (frontend/vitest.config.ts に clearMocks: true は入れていないため明示的に呼ぶ)
beforeEach(() => {
  mockedPost.mockReset();
});

describe('QrCodeGenerator', () => {
  // ──── ケース 1: 正常系 — フォーム送信のハッピーパス ────
  // ユーザがテキストを入力 → 生成ボタンを押す → apiClient.post が
  // 期待する引数で呼ばれる → 画面に成功メッセージが出る、までを追う。
  it('正常系: テキスト入力 → 送信で apiClient.post が呼ばれ成功メッセージが表示される', async () => {
    // 「成功した HTTP レスポンス」を vi.fn の戻り値として仕込む。
    // 本物の apiClient.post は { data, status, ok } 形を返すので、それに合わせる。
    mockedPost.mockResolvedValue({ data: { id: 1 }, status: 201, ok: true });

    // user-event の v14+ では setup() してから操作する。
    // この user インスタンスは内部に "前回のキーアップ状態" などを保持するため、
    // it ごとに作り直す (テスト間でキー状態が漏れないようにする)。
    const user = userEvent.setup();

    // jsdom 上にコンポーネントをマウント。document.body に挿入される。
    render(<QrCodeGenerator />);

    // <label htmlFor="qrcode-data"> の中身 (= 正規表現にマッチするテキスト) を頼りに
    // 関連付けられた <textarea> を取得する。アクセシビリティ寄りクエリ。
    const textarea = screen.getByLabelText(/QRコードに含めるデータ/);

    // 1 文字ずつ keydown → input イベントを発火させながら入力。
    // 本物のキー入力に近いので、onChange を持つコンポーネントの挙動を再現できる。
    await user.type(textarea, 'https://example.com');

    // ボタンは accessible name (= ボタンに表示されるテキスト) で取得。
    // QrCodeGenerator.tsx ではテキストが「QRコードを生成してS3にアップロード」なので
    // 正規表現で一部だけマッチさせている (将来のテキスト変更に強い)。
    const button = screen.getByRole('button', { name: /QRコードを生成/ });

    // ユーザー操作の最終ステップ。クリックで form の onSubmit が走り、
    // 内部で apiClient.post が await される。
    await user.click(button);

    // モックが想定通りの引数で呼ばれたかを検証。
    // QrCodeGenerator.tsx の `await apiClient.post('/qrcodes', { data })` を直接突く形。
    expect(mockedPost).toHaveBeenCalledWith('/qrcodes', { data: 'https://example.com' });

    // 成功メッセージは setSuccess(...) の後に出てくる非同期描画なので、
    // getByText (即取得・無ければ throw) ではなく findByText (見つかるまで待つ) を使う。
    // 内部実装は「waitFor + getByText」の糖衣で、デフォルト 1 秒待つ。
    //
    // .toBeInTheDocument() の意味:
    //   「渡された要素が、現在の document の DOM ツリー (document.body の下) に
    //   実際にアタッチされているか」を検査するマッチャ。
    //   @testing-library/jest-dom 由来で、frontend/src/test/setup.ts の
    //   `import '@testing-library/jest-dom/vitest'` によって Vitest の expect に
    //   後付けで追加されている (Vitest 標準には存在しない)。
    //
    //   - `expect(el).toBeTruthy()` は「JS オブジェクトとして null/undefined ではない」
    //     しか言えないが、toBeInTheDocument は「実際に画面 (document) に存在する」
    //     ことまで確認できる。
    //     例: document.createElement('div') した直後の要素は truthy だが
    //     not.toBeInTheDocument。el.remove() された要素も同様。
    //   - 失敗時のメッセージが「expected <p>QRコード...</p> to be in the document」のように
    //     要素のタグ名つきで出るので原因を追いやすい (toBeTruthy だと "expected null to be truthy"
    //     のような味気ない表示になる)。
    //   - 厳密には、findByText は「見つからなければ throw」なので、ここまで到達した時点で
    //     要素は document に存在することが保証されている。よって .toBeInTheDocument() は
    //     "冗長気味" だが、テストコードの意図 (= 画面に出ていることを assert したい) を
    //     読み手に明示する定型句として testing-library 公式も推奨している書き方。
    expect(await screen.findByText('QRコードを生成しました')).toBeInTheDocument();
  });

  // ──── ケース 2: 正常系 — カスタムイベントが発火される副作用を検証 ────
  // QrCodeGenerator は成功時に `window.dispatchEvent(new Event('qrcode-created'))` で
  // 親 (一覧表示側) に通知する。この副作用を listener を仕込んで検証する。
  //
  // dispatchEvent とは:
  //   ブラウザ標準の DOM API で、「JavaScript からイベントを手動で発火させる」関数。
  //   通常イベントは click / keydown / submit のようにユーザー操作で自動的に発生するが、
  //   dispatchEvent を使うとコード側から自発的にイベントを起こせる。
  //
  //   QrCodeGenerator.tsx の中ではこう書かれている (抜粋):
  //     window.dispatchEvent(new Event('qrcode-created'));
  //
  //   分解すると:
  //     - `new Event('qrcode-created')`
  //         → "qrcode-created" という名前のイベントオブジェクトを 1 個作る。
  //           "qrcode-created" は本プロジェクトで決めたカスタムなイベント名で、
  //           click や submit のような標準イベントとは別物 (好きな名前を付けられる)。
  //     - `window.dispatchEvent(event)`
  //         → 作ったイベントを window に向けて "発火" する。
  //           window に対して `addEventListener('qrcode-created', handler)` を貼って
  //           いる listener があれば、その handler が同期的に呼び出される。
  //
  //   何のためにこれを使っているか:
  //     React の props や Context を経由せず、"ブラウザのイベントバス" を介して
  //     離れたコンポーネント間で通知を投げる典型的な pub/sub パターン。
  //     本プロジェクトでは別の画面 (QR 一覧) が
  //       window.addEventListener('qrcode-created', () => refetch())
  //     のように購読していて、QR が新規作成されたら一覧を再取得する設計になっている。
  //
  //   テストでこれをどう検証するか (= 以下の handler のしくみ):
  //     テスト側でも同じ仕組みを使って "本物の購読者を模した listener" を window に貼り、
  //     コンポーネントが dispatchEvent を呼んだら handler が反応する → handler の呼び出し
  //     回数を見て発火を検証する、という流れ。
  it('正常系: 成功時に `qrcode-created` カスタムイベントが発火される', async () => {
    mockedPost.mockResolvedValue({ data: {}, status: 201, ok: true });

    // window に listener を貼る。testing-library の自動 cleanup は DOM はクリアするが
    // window 自体は維持されるため、明示的に removeEventListener しないと
    // 後続テストにも反応してしまう。try/finally で必ず外す。
    const handler = vi.fn();
    window.addEventListener('qrcode-created', handler);

    try {
      const user = userEvent.setup();
      render(<QrCodeGenerator />);

      await user.type(screen.getByLabelText(/QRコードに含めるデータ/), 'x');
      await user.click(screen.getByRole('button', { name: /QRコードを生成/ }));

      // post の解決 → setSuccess → dispatchEvent と続くので、
      // 「成功メッセージが出るまで待つ」ことで間接的に dispatchEvent 後を保証。
      await screen.findByText('QRコードを生成しました');

      // ちょうど 1 回 dispatchEvent されたか。0 回ならイベント未発火のバグ、
      // 2 回以上なら useEffect が二重実行などのバグ。
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('qrcode-created', handler);
    }
  });

  // ──── ケース 3: 異常系 — API が失敗したときのエラー表示 ────
  // apiClient.post が reject したら、catch 分岐で setError され、
  // 赤いメッセージが画面に出る — という UI の契約を検証する。
  it('異常系: API がエラーを投げたらエラーメッセージが表示される', async () => {
    // mockRejectedValue で Promise.reject(...) を返す挙動を仕込む。
    // QrCodeGenerator.tsx 側の try/catch がここで反応する。
    mockedPost.mockRejectedValue(new Error('network error'));

    const user = userEvent.setup();
    render(<QrCodeGenerator />);

    await user.type(screen.getByLabelText(/QRコードに含めるデータ/), 'data');
    await user.click(screen.getByRole('button', { name: /QRコードを生成/ }));

    // findByText で「失敗メッセージ」が現れるのを待つ。
    expect(await screen.findByText('QRコードの生成に失敗しました')).toBeInTheDocument();

    // queryByText は「見つからなければ null を返す」非 throw 版。
    // 「成功メッセージが出ていないこと」を確実に言うのにこちらを使う。
    // (getByText は見つからないと throw してしまうので .not.toBeInTheDocument と相性が悪い)
    expect(screen.queryByText('QRコードを生成しました')).not.toBeInTheDocument();
  });

  // ──── ケース 4: 異常系 — 空欄ガード ────
  // 入力が空のときはボタン自体が disabled になり、API は呼ばれない、
  // という UI のガードを検証する。ユーザー操作は最小限。
  it('異常系: 空欄ではボタンが disabled で API は呼ばれない', async () => {
    render(<QrCodeGenerator />);

    const button = screen.getByRole('button', { name: /QRコードを生成/ });

    // toBeDisabled() も jest-dom 拡張のマッチャ。
    // disabled 属性 / aria-disabled の両方をチェックしてくれる。
    expect(button).toBeDisabled();

    // ボタンが押せないので post は呼ばれない、というのを mock の呼び出し履歴で確認する。
    //
    // .toHaveBeenCalled() の意味:
    //   Vitest 標準のマッチャ (jest-dom ではなく Vitest 本体に同梱)。
    //   vi.fn() / vi.mocked() で作ったモック関数が「1 回以上呼ばれたか」を検査する。
    //
    // .not の意味:
    //   expect の汎用修飾子で、直後のマッチャの判定結果を反転させる (Vitest 標準)。
    //   どんなマッチャの前にも置ける (toBe / toEqual / toBeNull / toBeInTheDocument ... すべて可)。
    //     - `expect(x).not.toBe(y)`              → 「x が y と等しくない」
    //     - `expect(el).not.toBeInTheDocument()` → 「el が document に存在しない」(ケース 3 で使用)
    //     - `expect(fn).not.toHaveBeenCalled()`  → 「fn が一度も呼ばれていない」 ← この行
    //   単純な `!` で否定するより読みやすく、失敗メッセージも
    //   "expected ... not to have been called" のように文章寄りになる。
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
