import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAuthToken, setOnUnauthorized } from '../services/api';

export interface User {
  id: string;
  email: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initializeAuth: () => Promise<void>;
}

const STORAGE_KEY = '@ticket_system_auth';

export const useAuthStore = create<AuthState>((set, get) => {
  // Wire 401 callback to auto-logout
  setOnUnauthorized(() => {
    get().logout();
  });

  return {
    user: null,
    token: null,
    isLoading: false,
    isInitialized: false,

    initializeAuth: async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const { user, token } = JSON.parse(stored);
          setAuthToken(token);
          set({ user, token, isInitialized: true });
          return;
        }
      } catch {
        // Ignored
      }
      setAuthToken(null);
      set({ isInitialized: true });
    },

    login: async (email: string, password: string) => {
      set({ isLoading: true });
      try {
        const res = await api.post('/auth/login', { email, password });
        const { accessToken, user } = res.data;
        setAuthToken(accessToken);
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ user, token: accessToken })
        );
        set({ user, token: accessToken, isLoading: false });
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    },

    register: async (email: string, password: string) => {
      set({ isLoading: true });
      try {
        await api.post('/auth/register', { email, password });
        // Automatically login after successful registration
        const loginRes = await api.post('/auth/login', { email, password });
        const { accessToken, user } = loginRes.data;
        setAuthToken(accessToken);
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ user, token: accessToken })
        );
        set({ user, token: accessToken, isLoading: false });
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    },

    logout: async () => {
      try {
        await api.post('/auth/logout').catch(() => {});
      } finally {
        setAuthToken(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
        set({ user: null, token: null });
      }
    },
  };
});
