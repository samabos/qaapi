/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        green: 'var(--green)',
        red: 'var(--red)',
        yellow: 'var(--yellow)',
      },
      fontFamily: {
        mono: ['var(--vscode-editor-font-family)', 'IBM Plex Mono', 'monospace'],
        sans: ['var(--vscode-font-family)', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
