import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'padosipro_jwt_token';

export const useSessionStore = create((set, get) => ({
  user: null, // { id, email, profileComplete, selectedTaskCount }
  token: null,
  isRestoring: true, // true when app boots up

  // Restores the token on app startup
  restoreSession: async () => {
    try {
      const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (storedToken) {
        set({ token: storedToken });
      }
    } catch (e) {
      console.error('Failed to restore token', e);
    } finally {
      set({ isRestoring: false });
    }
  },

  // Called after successful login
  logIn: async (token, user) => {
    // Let save failure propagate up to the caller
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token, user });
  },

  // Updates user state (e.g. after calling /auth/me or /profile)
  setUser: (user) => set({ user }),

  // Logs out and clears state
  logOut: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (e) {
      console.error('Failed to delete token', e);
    } finally {
      set({ token: null, user: null });
    }
  },
}));
