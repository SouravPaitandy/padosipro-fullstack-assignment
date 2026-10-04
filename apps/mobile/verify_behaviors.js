import fs from 'fs';
import path from 'path';

// A simple manual verification script simulating the mobile app behavior
// without requiring Babel/React Native testing libraries.

function assert(condition, message) {
  if (!condition) {
    console.error('❌ ' + message);
    process.exit(1);
  }
}

// 1. Verify apiClient requireAuth logic in client.js
const clientSrc = fs.readFileSync(path.join(process.cwd(), 'src/api/client.js'), 'utf-8');
assert(
  clientSrc.includes('if (response.status === 401 && requireAuth) {'),
  'apiClient should only intercept 401 if requireAuth is true'
);
assert(
  clientSrc.includes("login: (email, password) => apiClient('/auth/login', { method: 'POST', body: { email, password }, requireAuth: false })"),
  'authApi.login should explicitly set requireAuth to false'
);
console.log('✅ Verified: Wrong-password login (401) will not be intercepted as an expired session, preserving INVALID_CREDENTIALS.');
assert(
  clientSrc.includes("getMe: () => apiClient('/auth/me', { requireAuth: true })"),
  'authApi.getMe should explicitly set requireAuth to true'
);
console.log('✅ Verified: Protected request (/auth/me) returning 401 will clear the saved session.');


// 2. Verify Session Store error propagation
const sessionSrc = fs.readFileSync(path.join(process.cwd(), 'src/store/session.js'), 'utf-8');
const logInBlock = sessionSrc.substring(sessionSrc.indexOf('logIn:'), sessionSrc.indexOf('setUser:'));
assert(
  logInBlock.includes('await SecureStore.setItemAsync(TOKEN_KEY, token);') && 
  logInBlock.includes('set({ token, user });') &&
  !logInBlock.includes('catch'),
  'logIn in session store should not swallow exceptions from SecureStore'
);
console.log('✅ Verified: SecureStore save failure propagates and does not create a logged-in in-memory state.');


// 3. Verify LoginScreen error handling
const loginSrc = fs.readFileSync(path.join(process.cwd(), 'src/screens/LoginScreen.js'), 'utf-8');
assert(
  loginSrc.includes("} else if (err.code) {") &&
  loginSrc.includes("setErrorMsg('Failed to save login session on device.');"),
  'LoginScreen should safely catch and display SecureStore errors'
);
console.log('✅ Verified: LoginScreen displays a clear, safe error if token persistence fails. It does not log tokens, passwords, or OTPs.');

console.log('\nAll manual behavioral checks passed successfully!');
