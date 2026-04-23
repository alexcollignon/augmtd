import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'clock-tick': {
          '0%':   { transform: 'rotate(0deg) scale(1)' },
          '40%':  { transform: 'rotate(200deg) scale(1.15)' },
          '70%':  { transform: 'rotate(340deg) scale(1.05)' },
          '100%': { transform: 'rotate(360deg) scale(1)' },
        },
        'fade-in-left': {
          '0%':   { opacity: '0', transform: 'translateX(-6px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'fade-out-left': {
          '0%':   { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(-6px)' },
        },
        'ob-welcome-out': {
          '0%':   { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.97)' },
        },
        'ob-split-in': {
          '0%':   { opacity: '0', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'ob-step-in': {
          '0%':   { opacity: '0', transform: 'translateX(18px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'ob-step-out': {
          '0%':   { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(-18px)' },
        },
      },
      animation: {
        'clock-tick':      'clock-tick 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fade-in-left':    'fade-in-left 0.2s ease-out',
        'fade-out-left':   'fade-out-left 0.15s ease-in forwards',
        'ob-welcome-out':  'ob-welcome-out 0.3s ease-in forwards',
        'ob-split-in':     'ob-split-in 0.35s ease-out forwards',
        'ob-step-in':      'ob-step-in 0.25s ease-out forwards',
        'ob-step-out':     'ob-step-out 0.2s ease-in forwards',
      },
      colors: {
        // AUGMTD Brand - Purple from logo
        primary: {
          DEFAULT: '#8B5CF6',
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
