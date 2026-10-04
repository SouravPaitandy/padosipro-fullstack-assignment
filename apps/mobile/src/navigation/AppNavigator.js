import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '../store/session';
import { colors } from '../theme/colors';

// Auth Screens
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import VerifyOtpScreen from '../screens/VerifyOtpScreen';

// Authenticated Screens
import ProfileScreen from '../screens/ProfileScreen';
import TaskSelectionScreen from '../screens/TaskSelectionScreen';
import HomeScreen from '../screens/HomeScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { isRestoring, token, user } = useSessionStore();

  if (isRestoring) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Determine which stack to show based on token and user onboarding flags
  let initialRouteName = 'Login';
  let isAuth = !!token;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
        {isAuth ? (
          // Authenticated Stack
          <Stack.Group>
            {(!user?.profileComplete) ? (
              <Stack.Screen name="Profile" component={ProfileScreen} />
            ) : (!user?.selectedTaskCount || user.selectedTaskCount === 0) ? (
              <Stack.Screen name="TaskSelection" component={TaskSelectionScreen} />
            ) : (
              <Stack.Group>
                <Stack.Screen name="Home" component={HomeScreen} />
                <Stack.Screen name="TaskSelection" component={TaskSelectionScreen} />
              </Stack.Group>
            )}
          </Stack.Group>
        ) : (
          // Unauthenticated Stack
          <Stack.Group>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
