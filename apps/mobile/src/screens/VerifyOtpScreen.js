import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '../api/client';
import { colors } from '../theme/colors';

export default function VerifyOtpScreen({ route, navigation }) {
  const { email, resendAvailableAt } = route.params || {};
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  // Timer state for resend cooldown
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!email) {
      navigation.replace('Login');
      return;
    }

    if (resendAvailableAt) {
      const ms = new Date(resendAvailableAt).getTime() - Date.now();
      if (ms > 0) {
        setCooldown(Math.ceil(ms / 1000));
      }
    }
  }, [email, resendAvailableAt, navigation]);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setErrorMsg('Please enter a 6-digit code.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      await authApi.verifyOtp(email, code);
      // Success! Back to login.
      navigation.navigate('Login');
    } catch (err) {
      setErrorMsg(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    
    setLoading(true);
    setErrorMsg(null);

    try {
      const data = await authApi.resendOtp(email);
      // Update cooldown based on the response
      if (data.resendAvailableAt) {
        const ms = new Date(data.resendAvailableAt).getTime() - Date.now();
        setCooldown(Math.max(0, Math.ceil(ms / 1000)));
      }
      setErrorMsg('A new code has been sent to your email.');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface justify-center p-4">
      <View className="bg-surfaceLight rounded-2xl p-6 border border-border shadow-sm elevation-2">
        <Text className="text-2xl font-bold text-textDark mb-2 text-center">Verify Email</Text>
        <Text className="text-base text-textMuted mb-6 text-center">Enter the 6-digit code sent to {email}</Text>

        {errorMsg && (
          <Text className={`mb-4 text-sm text-center ${errorMsg.includes('sent') ? 'text-primary' : 'text-error'}`}>
            {errorMsg}
          </Text>
        )}

        <TextInput
          className="bg-surface border border-border rounded-lg p-3 mb-6 text-2xl tracking-[8px] text-textDark text-center"
          placeholder="000000"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          editable={!loading}
          textAlign="center"
        />

        <TouchableOpacity 
          className={`bg-primary rounded-lg p-4 items-center ${loading ? 'opacity-70' : ''}`}
          onPress={handleVerify} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text className="text-surface text-base font-semibold">Verify</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          className="mt-5 items-center"
          onPress={handleResend}
          disabled={loading || cooldown > 0}
        >
          <Text className={`text-sm ${(loading || cooldown > 0) ? 'text-textMuted/50' : 'text-textMuted'}`}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          className="mt-5 items-center"
          onPress={() => navigation.navigate('Login')}
          disabled={loading}
        >
          <Text className="text-textMuted text-sm">Back to <Text className="text-primary font-semibold">Log In</Text></Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
