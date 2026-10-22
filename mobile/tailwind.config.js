/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#070B14',
          900: '#0B1120',
          850: '#11192C',
          800: '#162035',
          700: '#1E2B45',
          600: '#2E3E60',
        },
        cyan: {
          400: '#22D3EE',
          500: '#06B6D4',
          600: '#0891B2',
        },
        amber: {
          400: '#FBBF24',
          500: '#F59E0B',
        },
        ticket: {
          bg: '#141E33',
          stub: '#0E1728',
          border: '#2A3B5C',
        }
      },
    },
  },
  plugins: [],
};
