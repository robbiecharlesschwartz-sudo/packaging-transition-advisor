/** Design tokens live in src/index.css as CSS variables (dark default, .light override). */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), raised: v('raised'), muted: v('muted'), line: v('line'), strong: v('strong'),
        ink: v('ink'), sub: v('sub'), primary: v('primary'), 'primary-soft': v('primary-soft'),
        accent: v('accent'), 'accent-soft': v('accent-soft'), danger: v('danger'), ok: v('ok'), warn: v('warn'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: { h1: ['24px', '30px'], h2: ['15px', '21px'], body: ['13.5px', '20px'], sm2: ['12.5px', '18px'], xs2: ['11px', '15px'] },
    },
  },
  plugins: [],
};
