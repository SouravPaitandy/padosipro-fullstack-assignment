import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '../api/client';
import { colors } from '../theme/colors';

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const handleRegister = async () => {
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setFieldErrors({});

    try {
      const data = await authApi.register(email.trim(), password);
      // Registration successful (returns userId, email, verificationRequired, resendAvailableAt)
      // Pass the resendAvailableAt to the verify screen so it can handle the cooldown properly.
      navigation.navigate('VerifyOtp', { 
        email: email.trim(), 
        resendAvailableAt: data.resendAvailableAt 
      });
    } catch (err) {
      setErrorMsg(err.message || 'Registration failed.');
      if (err.fields) {
        setFieldErrors(err.fields);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface justify-center p-4">
      <View className="bg-surfaceLight rounded-2xl p-6 border border-border shadow-sm elevation-2">
        <Text className="text-2xl font-bold text-textDark mb-2">Create Account</Text>
        <Text className="text-base text-textMuted mb-6">Join PadosiPro to get started</Text>

        {errorMsg && <Text className="text-error mb-4 text-sm">{errorMsg}</Text>}

        <TextInput
          className={`bg-surface border ${fieldErrors.email ? 'border-error mb-1' : 'border-border mb-4'} rounded-lg p-3 text-base text-textDark`}
          placeholder="Email address"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!loading}
        />
        {fieldErrors.email && <Text className="text-error text-xs mb-3">{fieldErrors.email}</Text>}

        <TextInput
          className={`bg-surface border ${fieldErrors.password ? 'border-error mb-1' : 'border-border mb-4'} rounded-lg p-3 text-base text-textDark`}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />
        {fieldErrors.password && <Text className="text-error text-xs mb-3">{fieldErrors.password}</Text>}

        <TouchableOpacity 
          className={`bg-primary rounded-lg p-4 items-center mt-2 ${loading ? 'opacity-70' : ''}`}
          onPress={handleRegister} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text className="text-surface text-base font-semibold">Sign Up</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          className="mt-6 items-center"
          onPress={() => navigation.navigate('Login')}
          disabled={loading}
        >
          <Text className="text-textMuted text-sm">Already have an account? <Text className="text-primary font-semibold">Log In</Text></Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

