import { createContext } from 'react';

export interface User {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
