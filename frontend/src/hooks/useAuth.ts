// frontend/src/hooks/useAuth.ts
//
// このファイルの目的:
//   <AuthProvider> が提供している認証状態 ({ user, isLoading, logout }) を
//   任意のコンポーネントから取り出すためのカスタムフック。
//
// 仕組み:
//   - AuthContext (contexts/authContext.types.ts) は
//       createContext<AuthContextType | undefined>(undefined)
//     で「デフォルト値 undefined」で作られているため、<AuthProvider> の外側で
//     useContext(AuthContext) を呼ぶと undefined が返る。
//   - そのまま undefined を返すと呼び出し側で `auth.user` のようにアクセスした
//     瞬間に「Cannot read properties of undefined」となり、原因が辿りにくい。
//   - そこで useAuth では undefined を検出した時点で明示的に throw し、
//     「<AuthProvider> で囲み忘れている」と分かるメッセージを出す。
//     ── これが「Context Consumer に薄いガードを 1 枚噛ませる」典型パターン。
//
// 使い方の例:
//   const { user, isLoading, logout } = useAuth();
//
// テストの仕方:
//   frontend/src/hooks/__tests__/useAuth.test.tsx を参照。
//   `renderHook(() => useAuth(), { wrapper: AuthProvider })` の形で
//   Provider 配下にマウントしてからフックを呼び出す。

import { useContext } from 'react';
import { AuthContext } from '../contexts/authContext.types';

export const useAuth = () => {
  // AuthContext の Provider が祖先にあれば「Provider の value」が、
  // 無ければ createContext のデフォルト値である undefined が返る。
  const context = useContext(AuthContext);

  // undefined = <AuthProvider> で囲まれていない呼び出し。
  // (型としては AuthContextType | undefined なので TypeScript だけでは検知できず、
  //  ランタイムガードとしてここで明示的に落とす)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  // ここに到達したら context は { user, isLoading, logout } の AuthContextType。
  return context;
};

