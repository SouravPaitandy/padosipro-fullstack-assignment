import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { profileApi, authApi, ApiError } from '../api/client';
import { useSessionStore } from '../store/session';
import { colors } from '../theme/colors';

export default function ProfileScreen() {
  const setUser = useSessionStore((state) => state.setUser);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    address: '',
    businessName: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await profileApi.getProfile();
      if (response.profile) {
        setForm({
          name: response.profile.name || '',
          mobile: response.profile.mobile ? `+91 ${response.profile.mobile}` : '',
          address: response.profile.address || '',
          businessName: response.profile.businessName || '',
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load profile. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const validate = () => {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Name is required.';
    
    // Normalize mobile
    const rawMobile = form.mobile.replace(/\s+/g, '');
    const mobileRegex = /^(?:\+91)?([6-9]\d{9})$/;
    const match = rawMobile.match(mobileRegex);
    if (!match) {
      errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
    }
    
    if (!form.address.trim()) errors.address = 'Address is required.';
    
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    const rawMobile = form.mobile.replace(/\s+/g, '');
    const mobileRegex = /^(?:\+91)?([6-9]\d{9})$/;
    const normalizedMobile = rawMobile.match(mobileRegex)[1];

    try {
      // 1. Update Profile
      await profileApi.updateProfile({
        name: form.name.trim(),
        mobile: normalizedMobile,
        address: form.address.trim(),
        businessName: form.businessName.trim() || undefined,
      });

      // 2. Refresh /auth/me to update onboarding flags (profileComplete)
      const meResponse = await authApi.getMe();
      setUser(meResponse);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) {
          setFieldErrors(err.fields);
        } else {
          setError(err.message);
        }
      } else {
        setError('An unexpected error occurred while saving profile.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-[#FAFAF7]">
        <ActivityIndicator size="large" color="#126A56" />
      </View>
    );
  }

  if (error && !form.name && !form.mobile) { // Initial load error
    return (
      <View className="flex-1 justify-center items-center bg-[#FAFAF7] p-6">
        <Text className="text-red-600 text-center mb-4">{error}</Text>
        <TouchableOpacity 
          className="bg-[#126A56] py-3 px-6 rounded-xl"
          onPress={fetchProfile}
        >
          <Text className="text-white font-semibold">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-[#FAFAF7]"
    >
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <View className="mb-8 mt-12">
          <Text className="text-3xl font-bold text-slate-800 mb-2">Complete Profile</Text>
          <Text className="text-slate-500 text-base">Please fill in your details to continue.</Text>
        </View>

        {error && !fieldErrors.name ? (
          <View className="bg-red-50 p-4 rounded-xl border border-red-100 mb-6">
            <Text className="text-red-700">{error}</Text>
          </View>
        ) : null}

        <View className="space-y-6">
          <View>
            <Text className="text-sm font-medium text-slate-700 mb-2">Full Name *</Text>
            <TextInput
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 shadow-sm"
              placeholder="e.g. Rahul Sharma"
              placeholderTextColor="#94a3b8"
              value={form.name}
              onChangeText={(text) => setForm({ ...form, name: text })}
              editable={!submitting}
            />
            {fieldErrors.name && <Text className="text-red-500 text-sm mt-1">{fieldErrors.name}</Text>}
          </View>

          <View>
            <Text className="text-sm font-medium text-slate-700 mb-2">Mobile Number *</Text>
            <TextInput
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 shadow-sm"
              placeholder="+91 9876543210"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              value={form.mobile}
              onChangeText={(text) => setForm({ ...form, mobile: text })}
              editable={!submitting}
            />
            {fieldErrors.mobile && <Text className="text-red-500 text-sm mt-1">{fieldErrors.mobile}</Text>}
          </View>

          <View>
            <Text className="text-sm font-medium text-slate-700 mb-2">Address *</Text>
            <TextInput
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 shadow-sm"
              placeholder="Your full address"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={form.address}
              onChangeText={(text) => setForm({ ...form, address: text })}
              editable={!submitting}
            />
            {fieldErrors.address && <Text className="text-red-500 text-sm mt-1">{fieldErrors.address}</Text>}
          </View>

          <View>
            <Text className="text-sm font-medium text-slate-700 mb-2">Business Name (Optional)</Text>
            <TextInput
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-800 shadow-sm"
              placeholder="Your agency or shop name"
              placeholderTextColor="#94a3b8"
              value={form.businessName}
              onChangeText={(text) => setForm({ ...form, businessName: text })}
              editable={!submitting}
            />
            {fieldErrors.businessName && <Text className="text-red-500 text-sm mt-1">{fieldErrors.businessName}</Text>}
          </View>
        </View>

        <TouchableOpacity
          className={`mt-8 py-4 rounded-xl flex-row justify-center items-center ${submitting ? 'bg-[#126A56]/70' : 'bg-[#126A56]'}`}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-base font-semibold">Save Profile</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
