import React, { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import apiClient from '../lib/api';
import { AuthContext, type User } from './authContext.types';

// AuthProviderコンポーネント
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // ユーザー情報を保存（セッションで認証状態を保持）
  const login = (newUser: User) => {
    setUser(newUser);
  };

  // ログアウト処理
  const logout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      console.error('ログアウトエラー:', error);
    } finally {
      setUser(null);
    }
  };

  // 認証状態を確認（セッションから取得）
  const checkAuth = async () => {
    try {
      const response = await apiClient.get<{ user: User }>('/auth/user');
      setUser(response.data.user);
    } catch (error) {
      // error から安全に status を取り出す処理
      // TypeScriptでは catch(error) の error は unknown 型なので、いきなり error.status とは書けない
      // そのため3段階のチェックで安全にアクセスする:
      //   error                     → null や undefined でないか
      //   typeof error === 'object' → オブジェクトか（文字列や数値でないか）
      //   'status' in error         → status プロパティを持っているか
      // この3つを満たして初めて error.status に安全にアクセスできる
      //
      // 三項演算子部分:
      //   条件が全て true → (error as { status?: number }).status で status を取り出す
      //     ※ error as { status?: number } は型アサーション（「この error は { status?: number } 型だよ」とTSに教える）
      //   条件が false → undefined
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as { status?: number }).status
        : undefined;
      // 401（未認証）→ ログインしていないだけなのでエラーログを出さない
      // それ以外（500など）→ 本当のエラーなのでログを出す
      if (status !== 401) {
        console.error('認証確認エラー:', error);
      }
      // なぜこんなに面倒なのか:
      // ApiError クラスなら error.status を持っているが、catch にはどんな型のエラーでも
      // 飛んでくる可能性がある（ネットワークエラーなど）ため、安全にチェックする必要がある
      // ちなみに instanceof を使えばもう少し簡潔に書ける:
      //   if (!(error instanceof ApiError) || error.status !== 401) {
      //     console.error('認証確認エラー:', error);
      //   }
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // コンポーネントマウント時に認証状態を確認
  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

