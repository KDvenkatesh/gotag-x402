/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gotag: {
          bg: '#050a14',
          surface: '#0d1626',
          surface2: '#111d30',
          border: '#1e3054',
          borderHover: '#2a4a7f',
          green: '#00d084',
          cyan: '#06b6d4',
          blue: '#3b82f6',
          amber: '#f59e0b',
          red: '#ef4444',
        },
      },
      boxShadow: {
        glow: '0 0 30px rgba(6, 182, 212, 0.2)',
        'glow-green': '0 0 30px rgba(0, 208, 132, 0.25)',
        'glow-amber': '0 0 30px rgba(245, 158, 11, 0.25)',
        card: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      keyframes: {
        scanLine: {
          '0%, 100%': { top: '0%' },
          '50%': { top: 'calc(100% - 4px)' },
        },
        pulseRing: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.03)' },
        },
        fadeSlideIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        checkDraw: {
          from: { strokeDashoffset: '100' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'scan-line': 'scanLine 2.5s ease-in-out infinite',
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'check-draw': 'checkDraw 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards',
      },
    },
  },
  plugins: [],
};
