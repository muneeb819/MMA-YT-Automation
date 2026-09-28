import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f5f5f7',
          100: '#e8e8ed',
          200: '#c7c7d1',
          300: '#9a9aa6',
          400: '#6c6c78',
          500: '#45454f',
          600: '#2e2e38',
          700: '#23232b',
          750: '#1b1b21',
          800: '#15151a',
          850: '#0f0f13',
          900: '#0a0a0c',
          950: '#050506',
        },
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#a78bff',
          dim: '#4c3a99',
        },
        ember: '#ff5c47',
        mint: '#3ddc97',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.3)', opacity: '0' },
          '100%': { transform: 'scale(1.3)', opacity: '0' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 2s linear infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.24,0,0.38,1) infinite',
        'slide-in': 'slide-in 0.35s cubic-bezier(0.16,1,0.3,1) both',
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #7c5cff 0%, #a78bff 50%, #ff5c47 100%)',
        'panel-glow':
          'radial-gradient(1200px 600px at 50% -10%, rgba(124,92,255,0.18), transparent 60%)',
      },
    },
  },
  plugins: [],
};

export default config;
