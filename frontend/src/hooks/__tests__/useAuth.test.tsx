// frontend/src/hooks/__tests__/useAuth.test.tsx
//
// このファイルの目的:
//   `useAuth` カスタムフック (../useAuth.ts) の単体テスト。
//   testing-implementation-guide.md §1.1 の「Unit (フック)」分類に該当する。
//   一見 React コンポーネント (AuthProvider) を介しているように見えるが、
//   検証対象はフックの返り値とエラー挙動だけなので Unit テスト扱い。
//
// 検証する 4 ケース:
//   1. 異常系: AuthProvider の外で呼ぶとエラーを投げる
//   2. 正常系: 未ログイン状態 (getSession が { data: null }) では user が null
//   3. 正常系: セッションがあれば User オブジェクトを返す
//                 (id を number に変換, image → avatar_url)
//   4. 異常系: getSession が reject (= ネットワーク等の失敗) しても user は null で安定
//
// 外部依存の扱い:
//   - authClient (better-auth) → vi.mock でモジュールごと差し替え
//                                (実 HTTP を出さず、テスト側で戻り値を制御)
//   - DOM 環境              → jsdom (frontend/vitest.config.ts で environment: 'jsdom')
//   - フック実行            → @testing-library/react の renderHook
//   - 非同期完了待ち        → waitFor で isLoading が false になるのを待つ
//
// なお frontend/vitest.config.ts は `globals: true` のため
// describe/it/expect/vi/beforeEach は import 無しでも動くが、本プロジェクトでは
// 「ファイルが何を使っているか import から追える」方を優先して明示 import している。

// Vitest 本体: テスト記述 API (describe/it)、アサーション (expect)、
// モック (vi)、ライフサイクルフック (beforeEach) を提供。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// @testing-library/react:
//   renderHook — React フックを「ダミーコンポーネント経由」で実行できるヘルパ。
//                wrapper オプションで <Provider> 配下にマウントできる。
//                フックは「コンポーネント内でしか呼べない」という React の制約を
//                テスト用に回避する仕組み。
//   waitFor    — 「条件が満たされるまで関数を再評価し続ける」非同期待機ヘルパ。
//                AuthProvider の useEffect (= 非同期で setState する) が完了するのを
//                待つために使う。デフォルトで 1 秒、50ms 間隔で polling する。
import { renderHook, waitFor } from '@testing-library/react';

// ──────────────────────────────────────────────────────────
// authClient のモジュール丸ごと差し替え
// ──────────────────────────────────────────────────────────
// AuthProvider の useEffect では `authClient.getSession()` を呼んで
// 現在ログイン中のユーザーを取得しているが、本物だと better-auth が
// baseURL (例: http://localhost:3000) に対して HTTP リクエストを飛ばしてしまう。
// テストでは「getSession が何を返すか」だけをコントロールしたいので、
// authClient モジュールごと vi.mock で差し替える。
//
// factory の戻り値オブジェクトが、その import から見える module の export 形に
// なる。lib/auth-client.ts は `export const authClient = ...` (named export) なので、
// `authClient: { ... }` の形にする必要がある。
//
// vi.mock はファイル冒頭にホイストされる (詳細: docs/md/test/vitest-reference.md §6.3) ため、
// import より上に書いても下に書いても効果は同じ。
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),  // 各テストで mockResolvedValue / mockRejectedValue で戻り値を仕込む
    signOut: vi.fn(),     // AuthProvider 内の logout() が呼ぶ。本テストでは未使用だが
                          // 「全プロパティを揃えておく」ためにダミーを置いておく
  },
}));

// vi.mock のあとに import すると、上で差し替えた版が読まれる。
import { authClient } from '../../lib/auth-client';
import { useAuth } from '../useAuth';
import { AuthProvider } from '../../contexts/AuthContext';

// vi.mocked(...) はランタイム上は引数をそのまま返すだけのヘルパで、
// TypeScript の型を「これはモック関数だ」と付け替えるだけ
// (= mockResolvedValue / mock.calls などの型補完が効くようにする)。
// 詳細: docs/md/test/vitest-reference.md §6.7
const mockedGetSession = vi.mocked(authClient.getSession);

// 各テストの直前に呼ばれる。前のテストで仕込んだ mockResolvedValue や
// 呼び出し履歴 (mock.calls) を 0 にリセットする。
// (frontend/vitest.config.ts に clearMocks: true は入れていないため明示的に呼ぶ)
beforeEach(() => {
  mockedGetSession.mockReset();
});

describe('useAuth', () => {
  // ──── ケース 1: 異常系 — AuthProvider で囲まれていないと throw する ────
  // useAuth は内部で「context が undefined なら throw する」というガードを
  // 持っている (../useAuth.ts 参照)。renderHook を **wrapper 無し** で呼ぶと、
  // AuthContext.Provider が祖先に存在しない状態でフックが実行されるため、
  // useContext(AuthContext) が createContext のデフォルト値 undefined を返し
  // → useAuth 内の `throw new Error(...)` が走る。
  //
  // renderHook はレンダリング中に throw された例外を「外側に再 throw」する設計
  // なので、expect(() => renderHook(...)).toThrow(...) で素直に捕まえられる。
  it('異常系: AuthProvider の外で呼ぶとエラーを投げる', () => {
    // renderHook の中で throw されたエラーは外側に伝播する
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    );
  });

  // ──── ケース 2: 正常系 — 未ログイン (セッション無し) のとき user は null ────
  // AuthProvider の useEffect は内部で
  //   const { data: session } = await authClient.getSession();
  // を呼び、session が無ければ setUser(null) で確定させる。
  // mockResolvedValue({ data: null }) で「セッション無し」を再現する。
  //
  // waitFor で isLoading が false になるのを待つ理由:
  //   useEffect は initial render の後に非同期で走り、その中で setIsLoading(false)
  //   される。waitFor 無しに result.current を見ると、まだ isLoading: true の
  //   初期値が返ってきてしまう。
  it('正常系: 未ログイン状態では user が null', async () => {
    // `as never` は better-auth の getSession() の戻り値型が discriminated union
    // (data | error の組み合わせ) で厳密なため、テスト用の最小オブジェクトを
    // 通すための型エスケープ。ロジック検証だけが目的なので可。
    mockedGetSession.mockResolvedValue({ data: null } as never);

    // wrapper: AuthProvider で Provider 配下にマウント → useContext は valid な
    // context を返す → useAuth の throw は走らない。
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    // useEffect が走り、setIsLoading(false) が叩かれるまで待つ。
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // セッション無し → user は null のまま。
    expect(result.current.user).toBeNull();
    // logout は AuthContextType のインターフェースとして必ず関数で提供される
    // (型レベルだけでなくランタイムで持っていることを確認)。
    expect(typeof result.current.logout).toBe('function');
  });

  // ──── ケース 3: 正常系 — セッションがあれば User オブジェクトを返す ────
  // ここでの主な検証ポイントは **AuthProvider 側の整形ロジック** が走ること:
  //   - better-auth が返す session.user.id は string ("42") だが、
  //     AuthProvider が Number() で number に変換している
  //   - session.user.image は url または null。AuthProvider が `image ?? null` で
  //     avatar_url にキー名を変えながら受け渡している
  // つまり「外部 API のレスポンス形 → アプリ内 User 型」のマッピングを
  // 1 段挟んでいる、その変換が正しく走るかを assert する。
  it('正常系: セッションがあれば User オブジェクトを返す', async () => {
    mockedGetSession.mockResolvedValue({
      data: {
        user: {
          id: '42',                                  // ← string で返ってくる
          name: 'Alice',
          email: 'alice@example.com',
          image: 'http://example.com/a.png',         // ← image というキー名
        },
      },
    } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 整形後の期待値: id は number、image は avatar_url にリネームされている。
    expect(result.current.user).toEqual({
      id: 42,
      name: 'Alice',
      email: 'alice@example.com',
      avatar_url: 'http://example.com/a.png',
    });
  });

  // ──── ケース 4: 異常系 — getSession が reject しても user は null で安定 ────
  // ネットワーク断・サーバーエラーなどで authClient.getSession() が throw する
  // ケース。AuthProvider の useEffect の try/catch で catch 分岐に入り、
  // setUser(null) のままになる ── つまり「未ログイン扱いとしてアプリを継続させる」
  // という UI 上の契約を担保する。
  //
  // mockRejectedValue は「呼び出されたら Promise.reject(...) を返す」モック挙動。
  it('異常系: getSession が reject したら user は null', async () => {
    mockedGetSession.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    // reject されても finally で setIsLoading(false) が走るので、
    // waitFor は同じ条件で抜ける。「アプリがフリーズしない」の確認も兼ねる。
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // catch 分岐後の最終状態: user は null のまま。
    expect(result.current.user).toBeNull();
  });
});

