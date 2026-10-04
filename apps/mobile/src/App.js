import '../global.css';
import React, { useEffect } from 'react';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './navigation/AppNavigator';
import { useSessionStore } from './store/session';
import { authApi } from './api/client';

export default function App() {
  const { restoreSession, token, setUser } = useSessionStore();

  useEffect(() => {
    // Check SecureStore and load the token on mount
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    // If a token was restored, verify it with the server and fetch the user summary
    let mounted = true;
    async function verifySession() {
      if (!token) return;
      try {
        const data = await authApi.getMe();
        if (mounted) {
          setUser(data);
        }
      } catch (err) {
        // If 401, the client throws ApiError('UNAUTHORIZED') and triggers logOut inside apiClient.
        // We just catch it here so it doesn't crash the app on startup.
        console.log('Session verification failed:', err.message);
      }
    }
    verifySession();
    return () => { mounted = false; };
  }, [token, setUser]);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
