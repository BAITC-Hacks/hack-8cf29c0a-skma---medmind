/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'chart-series-1': 'var(--chart-series-1)',
        'chart-series-2': 'var(--chart-series-2)',
        'page-bg': 'var(--page-bg)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'accent-solid': 'var(--accent-solid)',
        'accent-hover': 'var(--accent-hover)',
        'accent-active': 'var(--accent-active)',
        'accent-text': 'var(--accent-text)',
        'accent-subtle-bg': 'var(--accent-subtle-bg)',
        'accent-subtle-text': 'var(--accent-subtle-text)',
        'accent-focus-ring': 'var(--accent-focus-ring)',
        'status-good': 'var(--status-good)',
        'status-warning': 'var(--status-warning)',
        'status-serious': 'var(--status-serious)',
        'status-critical': 'var(--status-critical)',
      },
    },
  },
  plugins: [],
}
