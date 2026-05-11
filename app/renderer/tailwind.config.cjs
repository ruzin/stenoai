/** @type {import('tailwindcss').Config} */
const path = require('node:path');
const animate = require('tailwindcss-animate');

module.exports = {
  darkMode: ['class'],
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1200px' },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['Charter', 'Bitstream Charter', 'Sitka Text', 'Iowan Old Style', 'Cambria', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        'accent-primary': 'hsl(var(--accent-primary))',
        paper: {
          0: '#FAF9F5',
          1: '#F5F3EC',
          2: '#EFEBE1',
          3: '#E5DFD1',
        },
        ink: {
          900: '#1B1B19',
          700: '#3D3D39',
          500: '#6B6B66',
          300: '#A8A8A0',
          100: '#D6D4CB',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 6px)',
        '2xl': 'calc(var(--radius) + 12px)',
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.3' }],
        sm: ['14px', { lineHeight: '1.55' }],
        base: ['15px', { lineHeight: '1.55' }],
        md: ['17px', { lineHeight: '1.5' }],
        lg: ['22px', { lineHeight: '1.3' }],
        xl: ['30px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        '2xl': ['44px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        '3xl': ['64px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        sm: '0 1px 2px rgba(27, 27, 25, 0.05)',
        DEFAULT: '0 1px 2px rgba(27, 27, 25, 0.05)',
        md: '0 8px 24px -8px rgba(27, 27, 25, 0.14), 0 2px 4px -2px rgba(27, 27, 25, 0.06)',
        lg: '0 24px 48px -16px rgba(27, 27, 25, 0.22), 0 4px 8px -4px rgba(27, 27, 25, 0.08)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 200ms cubic-bezier(0.2, 0, 0, 1)',
        'accordion-up': 'accordion-up 200ms cubic-bezier(0.2, 0, 0, 1)',
        'fade-in': 'fade-in 0.4s ease-out both',
        'spin-fast': 'spin 0.55s linear infinite',
      },
      transitionTimingFunction: {
        steno: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '200ms',
        slow: '320ms',
      },
    },
  },
  plugins: [animate],
};
