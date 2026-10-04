import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '../api/client';
import { useSessionStore } from '../store/session';
import { colors } from '../theme/colors';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const { logIn } = useSessionStore();

  const handleLogin = async () => {
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await authApi.login(email.trim(), password);
      // Success
      await logIn(data.accessToken, data.user);
      // AppNavigator will automatically switch to the Authenticated stack based on token/user presence.
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        // Need to verify email first. Route to verify OTP.
        navigation.navigate('VerifyOtp', { email: email.trim() });
      } else if (err.code) {
        // API Error
        setErrorMsg(err.message || 'Login failed.');
      } else {
        // SecureStore / internal error (no code)
        setErrorMsg('Failed to save login session on device.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface justify-center p-4">
      <View className="bg-surfaceLight rounded-2xl p-6 border border-border shadow-sm elevation-2">
        <Text className="text-2xl font-bold text-textDark mb-2">Welcome Back</Text>
        <Text className="text-base text-textMuted mb-6">Log in to PadosiPro</Text>

        {errorMsg && <Text className="text-error mb-4 text-sm">{errorMsg}</Text>}

        <TextInput
          className="bg-surface border border-border rounded-lg p-3 mb-4 text-base text-textDark"
          placeholder="Email address"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!loading}
        />
        <TextInput
          className="bg-surface border border-border rounded-lg p-3 mb-4 text-base text-textDark"
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />

        <TouchableOpacity 
          className={`bg-primary rounded-lg p-4 items-center mt-2 ${loading ? 'opacity-70' : ''}`}
          onPress={handleLogin} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text className="text-surface text-base font-semibold">Log In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          className="mt-6 items-center"
          onPress={() => navigation.navigate('Register')}
          disabled={loading}
        >
          <Text className="text-textMuted text-sm">Don't have an account? <Text className="text-primary font-semibold">Sign Up</Text></Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

