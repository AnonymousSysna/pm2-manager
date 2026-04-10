/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      maxWidth: {
        layout: "1600px"
      },
      spacing: {
        header: "72px"
      },
      width: {
        "nav-drawer": "85%"
      },
      minHeight: {
        "route-fallback": "40vh"
      },
      height: {
        "log-viewer": "68vh"
      },
      maxHeight: {
        "log-viewer": "68vh",
        "modal-content": "70vh"
      },
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--color-surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--color-surface-3) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "text-1": "rgb(var(--color-text-1) / <alpha-value>)",
        "text-2": "rgb(var(--color-text-2) / <alpha-value>)",
        "text-3": "rgb(var(--color-text-3) / <alpha-value>)",
        brand: {
          400: "rgb(var(--color-brand-400) / <alpha-value>)",
          500: "rgb(var(--color-brand-500) / <alpha-value>)",
          600: "rgb(var(--color-brand-600) / <alpha-value>)"
        },
        success: {
          300: "rgb(var(--color-success-300) / <alpha-value>)",
          500: "rgb(var(--color-success-500) / <alpha-value>)",
          600: "rgb(var(--color-success-600) / <alpha-value>)"
        },
        danger: {
          300: "rgb(var(--color-danger-300) / <alpha-value>)",
          500: "rgb(var(--color-danger-500) / <alpha-value>)",
          600: "rgb(var(--color-danger-600) / <alpha-value>)"
        },
        warning: {
          300: "rgb(var(--color-warning-300) / <alpha-value>)",
          500: "rgb(var(--color-warning-500) / <alpha-value>)",
          600: "rgb(var(--color-warning-600) / <alpha-value>)"
        },
        info: {
          300: "rgb(var(--color-info-300) / <alpha-value>)",
          500: "rgb(var(--color-info-500) / <alpha-value>)",
          600: "rgb(var(--color-info-600) / <alpha-value>)"
        }
      }
    }
  },
  plugins: []
};
