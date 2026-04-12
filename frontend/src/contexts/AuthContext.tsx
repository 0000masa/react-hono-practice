import React, { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AuthContext, type User } from './authContext.types';
import { authClient } from '../lib/auth-client';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: session } = await authClient.getSession();
        if (session?.user) {
          setUser({
            id: Number(session.user.id),
            name: session.user.name,
            email: session.user.email,
            avatar_url: session.user.image ?? null,
          });
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  const logout = async () => {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error('ログアウトエラー:', error);
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
