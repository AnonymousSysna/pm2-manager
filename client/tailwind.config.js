/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b1220",
        surface: "#111a2b",
        "surface-2": "#16233a",
        "surface-3": "#1f2f4d",
        border: "#2a3a59",
        "text-1": "#e2e8f0",
        "text-2": "#cbd5e1",
        "text-3": "#94a3b8",
        brand: {
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a"
        },
        success: {
          300: "#86efac",
          500: "#22c55e",
          600: "#16a34a"
        },
        danger: {
          300: "#fca5a5",
          500: "#ef4444",
          600: "#dc2626"
        },
        warning: {
          300: "#fcd34d",
          500: "#f59e0b",
          600: "#d97706"
        },
        info: {
          300: "#93c5fd",
          500: "#3b82f6",
          600: "#2563eb"
        }
      }
    }
  },
  plugins: []
};
