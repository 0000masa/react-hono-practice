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
      // 401エラー（未認証）の場合は正常な状態なので、エラーを無視
      const status = error && typeof error === 'object' && 'status' in error
        ? (error as { status?: number }).status
        : undefined;
      if (status !== 401) {
        console.error('認証確認エラー:', error);
      }
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

