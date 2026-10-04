/** @type {import('tailwindcss').Config} */
module.exports = {
  // Update this to include the paths to all of your component files.
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        surface: '#FAFAF7',
        surfaceLight: '#FFFFFF',
        primary: '#126A56',
        textDark: '#1E293B',
        textMuted: '#64748B',
        selectedMint: '#D1FAE5',
        accentGold: '#D97706',
        border: '#E2E8F0',
        error: '#EF4444',
      }
    },
  },
  plugins: [],
}
