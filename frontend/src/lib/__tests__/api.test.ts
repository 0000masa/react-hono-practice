// frontend/src/lib/__tests__/api.test.ts
//
// このファイルの目的:
//   `frontend/src/lib/api.ts` が export している HTTP クライアント (apiClient.get /
//   apiClient.post / 共通の request 関数) の挙動を、ネットワークを実際に叩かず
//   ユニットテスト層で検証する。具体的には:
//     - URL 組み立て (API_BASE_URL + path + URLSearchParams) が期待通りか
//     - POST 時に method / body / Content-Type / credentials が正しく付くか
//     - 401 を受けたとき /login へのリダイレクトが「ログイン以外のページのときだけ」走るか
//     - 401 以外のエラー (500 等) は ApiError として throw されるだけでリダイレクトしないか
//
//   隣接する frontend/src/components/__tests__/QrCodeGenerator.test.tsx は
//   "コンポーネントテスト層" (UI 視点の振る舞いを検証) なのに対し、
//   こちらは "ユニットテスト層" (関数の入出力を検証) に位置づけられる。
//   テスト層の対応関係は docs/md/test/react-hono-testing-faq.md §3.2 を参照。
//
// いつ呼ばれるか:
//   - `npm test` / `npx vitest run` で Vitest が collect する
//   - 環境設定は frontend/vitest.config.ts (environment: 'jsdom', globals: true)
//   - CI でも同じ vitest コマンド経由で実行される (.github/workflows/ 配下)
//
// 検証する 5 ケース:
//   1. 正常系: apiClient.get('/users', { params }) → クエリ文字列を URL に付加
//   2. 正常系: apiClient.get('/users') (params なし) → ? を付けない
//   3. 正常系: apiClient.post('/users', body) → JSON body + Content-Type + credentials
//   4. 異常系: /login 以外で 401 → ApiError throw かつ window.location.href = '/login'
//   5. 異常系: /login 自身で 401 → ApiError throw だけしてリダイレクトはしない (無限ループ防止)
//   6. 異常系: 500 → ApiError throw だけ (リダイレクトは 401 専用) ※「3 ケース」と書いているが
//      describe('401 ハンドリング') 配下に 500 のテストも同居している点に注意
//
// 外部依存の扱い:
//   - グローバル `fetch` → vi.stubGlobal で vi.fn() に差し替える (本物の HTTP は飛ばない)
//   - `window.location` → jsdom では基本 read-only なので Object.defineProperty で
//     書き換え可能な記述子に差し替えてからモック値を入れる
//   - DOM 環境 → jsdom (frontend/vitest.config.ts で `environment: 'jsdom'`)
//
// なお frontend/vitest.config.ts は `globals: true` を有効にしているため
// describe/it/expect/vi/beforeEach/afterEach は本来 import しなくても動く。
// ただし本プロジェクトでは「ファイルが何を使っているか import から追える」方を
// 優先して、敢えて明示 import している (QrCodeGenerator.test.tsx と同じ方針)。
// なお jest-dom 拡張マッチャ (toBeInTheDocument 等) はここでは使わない
// (純粋にロジックの入出力を見るだけなので)。

// Vitest 本体:
//   describe / it    — テストツリー定義
//   expect           — アサーション
//   vi               — モック・スタブ・スパイの API (vi.fn / vi.stubGlobal など)
//   beforeEach / afterEach — 各テストの前後に走るライフサイクルフック
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 被テスト対象。frontend/src/lib/api.ts の `export default apiClient` を読む。
// ../api は frontend/src/lib/api.ts のことで、apiClient は get/post/put/delete を持つオブジェクト。
import apiClient from '../api';

// ──────────────────────────────────────────────────────────
// window.location と fetch の差し替えセットアップ
// ──────────────────────────────────────────────────────────
// このブロックは本ファイルで一番のキモなので少し丁寧に解説する。
//
// なぜ window.location を書き換えたいか:
//   api.ts の 401 ハンドリングが `window.location.pathname` を読み、
//   `window.location.href = '/login'` で遷移指示を出している (api.ts:91-93)。
//   テストでは「いまどのパスにいるか」を自由に差し替えて、リダイレクトが
//   走った/走らなかった、を検証したい。
//
// なぜ Object.defineProperty を使うか:
//   jsdom の window.location は通常 read-only。素直に
//     window.location = { pathname: '/' }
//   や
//     window.location.href = '/login'
//   と書こうとすると、ブラウザ仕様によっては TypeError: Cannot assign to read only
//   property になる。Object.defineProperty で
//     configurable: true (後で再定義できる) / writable: true (代入を許す)
//   のディスクリプタごと丸ごと差し替えてしまえば、以降の `window.location.href = ...` も
//   素の代入として通せるようになる。
//
// なぜ originalLocation を退避するか:
//   テスト終了時に元に戻さないと、他のテストファイル (例: QrCodeGenerator.test.tsx) が
//   この置き換えの影響を受けてしまうため。テスト間の独立性を担保する常套手段。
const originalLocation = window.location;

beforeEach(() => {
  // 各 it の直前に毎回呼ばれる。
  // pathname / href の 2 つだけ持つ最小モックで十分なのは、
  // api.ts 側で参照しているのがこの 2 プロパティだけだから (api.ts:91, 93)。
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { pathname: '/', href: '/' },
  });

  // グローバル fetch を Vitest 管理のモック関数 (vi.fn()) に差し替える。
  // - vi.stubGlobal はテスト終了時 (vi.unstubAllGlobals 呼び出し時) に元に戻せる仕組み。
  // - 戻り値は it 内で fetchMock.mockResolvedValue(...) を使って仕込む。
  // - これを忘れるとテストから本物のネットワークを叩きに行ってしまう。
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  // window.location を退避していた元の参照に戻す。
  // beforeEach で configurable: true にしてあるので再定義できる。
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });

  // vi.stubGlobal で差し替えたグローバル (= fetch) をすべて元に戻す。
  // これがないと後続のテストファイルにモック済み fetch が漏れる。
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────
// apiClient.get: GET リクエストと URL 組み立て
// ──────────────────────────────────────────────────────────
describe('apiClient.get', () => {
  // ──── ケース 1: 正常系 — params を URL のクエリ文字列に展開する ────
  // api.ts:51-71 の URLSearchParams 展開ロジックを検証する。
  it('正常系: クエリパラメータを URL に組み込む', async () => {
    // `fetch as unknown as ReturnType<typeof vi.fn>` の二段階キャストは:
    //   - fetch の本来の型は `typeof fetch` (= 引数/戻り値が固定された関数型)
    //   - vi.stubGlobal で実体は vi.fn() に差し替わっているので、
    //     mock 用 API (mockResolvedValue / mock.calls 等) を呼びたい
    //   → 一度 unknown を経由して「Vitest のモック関数型」へ再解釈する
    // unknown を挟むのは TypeScript が「無関係な型同士の直接キャスト」を弾くため。
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    // mockResolvedValue: vi.fn() を「Promise.resolve(...) を返す関数」に仕立てる。
    // ここでは api.ts:86 の `await fetch(...)` が返す Response 風オブジェクトを偽装している。
    // .json() メソッドも async として返している点に注意 (本物の Response と同じ非同期 API)。
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [] }),
    });

    // 被テスト呼び出し: { params: { page: 1, sort: 'name' } } を渡す。
    // api.ts の URLSearchParams 経由で "page=1&sort=name" に直列化されるはず。
    const res = await apiClient.get('/users', { params: { page: 1, sort: 'name' } });

    // 1 回だけ呼ばれた (= 余計な再リクエストなし) ことの確認。
    expect(fetchMock).toHaveBeenCalledOnce();

    // fetchMock.mock.calls[0][0] の読み方:
    //   - mock.calls   : 「呼び出しごとの引数配列」の配列。例: [[url, init], [url, init], ...]
    //   - mock.calls[0]: 1 回目の呼び出し。中身は [url, init]
    //   - mock.calls[0][0]: 1 回目の呼び出しの第 1 引数 = URL
    // 期待値は API_BASE_URL ('/api') + '/users' + URLSearchParams.toString()。
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users?page=1&sort=name');

    // 戻り値は ApiResponse<T> 形 (api.ts:103 の `{ data, status, ok }`)。
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
  });

  // ──── ケース 2: 正常系 — params が無いときは ? を付けない ────
  // api.ts:51 の `if (options?.params)` 分岐が falsy 側に倒れることの確認。
  // 「ない」ことを保証するテストは、将来 URLSearchParams を無条件で
  // 付けるリグレッションを入れた瞬間に落ちてくれるための備え。
  it('正常系: params が空のときは ? が付かない', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiClient.get('/users');

    // ? も & も付与されていない、素のパスであること。
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users');
  });
});

// ──────────────────────────────────────────────────────────
// apiClient.post: POST リクエスト時の RequestInit 組み立て
// ──────────────────────────────────────────────────────────
describe('apiClient.post', () => {
  // ──── ケース 3: 正常系 — JSON body と必須ヘッダを付けて送信 ────
  // 検証点は fetch の第 2 引数 (RequestInit) が以下を満たすこと:
  //   - method: 'POST'
  //   - body: JSON.stringify した文字列   (api.ts:82-83 の if (options?.data) 分岐)
  //   - Content-Type: 'application/json'  (api.ts:75-77)
  //   - credentials: 'include'            (api.ts:79 / Cookie を載せるための設定)
  it('正常系: JSON body と Content-Type を付けて送信する', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 1 }),
    });

    await apiClient.post('/users', { name: 'Alice' });

    // 分割代入 + as キャストの組み合わせ:
    //   - fetchMock.mock.calls[0]                      : 1 回目の呼び出しの引数配列
    //   - as [string, RequestInit]                     : mock.calls の要素は any[] 扱いなので型を付け直す
    //   - [, opts]                                     : 第 1 引数 (URL) は使わないのでスキップして
    //                                                    第 2 引数だけ opts として受け取る
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(opts.method).toBe('POST');

    // body は文字列化されている。JSON.stringify は順序保持なのでこの比較で安全。
    expect(opts.body).toBe(JSON.stringify({ name: 'Alice' }));

    // Record<string, string> とは:
    //   TypeScript 組み込みのユーティリティ型で「キーが string・値が string のオブジェクト」を表す。
    //   Record<K, V> は { [key: K]: V } (= index signature) と同義の糖衣構文。
    //   例:
    //     Record<string, string>      → { 'Content-Type': 'application/json', 'Accept': '*/*' } など
    //     Record<string, number>      → { count: 5, total: 100 } など
    //     Record<'a' | 'b', boolean>  → { a: true, b: false } (キーを literal の union に限定する使い方も可)
    //
    // headers as Record<string, string> のキャストは、
    // 本来 headers の型が HeadersInit (Record | Headers | [string,string][]) という union のため、
    // ピンポイントで `[key]` でアクセスできる形に絞り込んで型エラーを避けている。
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    // credentials: 'include' は Cookie/Authorization をクロスオリジン含めて送信する設定。
    // 認証セッションを Cookie で持たせるバックエンドと組む際に必須。
    expect(opts.credentials).toBe('include');
  });
});

// ──────────────────────────────────────────────────────────
// 401 ハンドリング: リダイレクトと throw の組み合わせを検証
// ──────────────────────────────────────────────────────────
// api.ts:88-100 の分岐を 3 ケースで網羅する:
//   - 401 かつ /login 以外  → /login へリダイレクト + ApiError throw
//   - 401 かつ /login        → リダイレクトせず ApiError だけ throw (ループ防止ガード)
//   - 401 以外 (例: 500)    → リダイレクトせず ApiError だけ throw
describe('401 ハンドリング', () => {
  // ──── ケース 4: 異常系 — /login 以外で 401 → /login にリダイレクト ────
  it('異常系: /login 以外で 401 を受け取ったら /login にリダイレクトする', async () => {
    // 現在地を /dashboard に偽装。api.ts:91 の currentPath がこの値を読む。
    // (window.location as unknown as { pathname: string }) のキャストは、
    // モック化した window.location が本物の Location 型ではないので、
    // 「pathname を持つだけの最小オブジェクト」として TS を納得させるためのもの。
    (window.location as unknown as { pathname: string }).pathname = '/dashboard';

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    // await expect(...).rejects.toThrow(/.../) の読み方:
    //   - rejects   : Promise が reject されることを前提に、reject 値に対してマッチャを適用する Vitest 修飾子
    //   - toThrow   : エラーオブジェクトが投げられたかを検査するマッチャ
    //   - /status 401/ : エラーメッセージに対する正規表現での部分一致
    // api.ts:99 の `throw new ApiError(\`Request failed with status ${response.status}\`, response.status)` と対応。
    await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);

    // throw に加えて、リダイレクト副作用 (window.location.href の書き換え) が起きていることも同時に検証。
    // 1 ケースで「エラーを投げる」+「画面遷移を促す」両方を見ることで、
    // 片方だけ動いて片方が動かない部分実装の退化を 1 本のテストで捕まえられる。
    expect(window.location.href).toBe('/login');
  });

  // ──── ケース 5: 異常系 — /login で 401 → リダイレクトしない (無限ループ防止) ────
  it('異常系: /login 自身で 401 を受け取ってもリダイレクトしない (ループ防止)', async () => {
    // 現在地を /login に偽装。
    // 仮にここで /login にリダイレクトしてしまうと、/login → 401 → /login → 401 ... の無限ループになる。
    // api.ts:92 の `if (currentPath !== '/login' && currentPath !== '/auth/callback')` ガードが
    // ここで効くことを検証している。
    (window.location as unknown as { pathname: string }).pathname = '/login';

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    // throw 自体は 401 として走るので確認しておく。
    await expect(apiClient.get('/users')).rejects.toThrow(/status 401/);

    // 期待値 '/' は beforeEach で入れた初期値そのまま。
    // すなわち「href への代入が一度も発生しなかった = リダイレクトが起きていない」ことを意味する。
    expect(window.location.href).toBe('/');
  });

  // ──── ケース 6: 異常系 — 500 はリダイレクト対象外 ────
  // 401 以外のエラー (サーバ内部エラー等) は ApiError として throw されるだけで、
  // 画面遷移は呼び出し元の UI に委ねる、という分岐 (api.ts:90-95 を通らないルート) の検証。
  it('異常系: 500 エラーは ApiError として throw される', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(apiClient.get('/users')).rejects.toThrow(/status 500/);
    expect(window.location.href).toBe('/'); // リダイレクトは 401 だけ
  });
});
