/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        aura: {
          50: '#f5f7fa',
          100: '#e4e7eb',
          200: '#cbd2d9',
          300: '#9aa5b1',
          400: '#52667a',
          500: '#314457',
          600: '#202e3b',
          700: '#151e28',
          800: '#0f141b',
          900: '#090c10',
          accent: '#8b5cf6',
          cyan: '#06b6d4',
          emerald: '#10b981'
        }
      }
    },
  },
  plugins: [],
}
