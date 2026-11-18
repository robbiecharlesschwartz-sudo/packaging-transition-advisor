/** Design tokens live in src/index.css as CSS variables (light + dark); Tailwind maps names to them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        muted: v('muted'),
        line: v('line'),
        ink: v('ink'),
        sub: v('sub'),
        primary: v('primary'),
        'primary-soft': v('primary-soft'),
        accent: v('accent'),
        'accent-soft': v('accent-soft'),
        danger: v('danger'),
        ok: v('ok'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      fontSize: { h1: ['32px', '40px'], h2: ['22px', '30px'], body: ['16px', '24px'], sm2: ['14px', '20px'], xs2: ['12px', '16px'] },
      borderRadius: { card: '10px' },
    },
  },
  plugins: [],
};
