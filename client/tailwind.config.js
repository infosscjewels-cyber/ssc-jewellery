/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0A192F', 
          light: '#172A46',
        },
        accent: {
          DEFAULT: '#D4AF37', // Use this for Buttons or Dark Backgrounds
          hover: '#B3932B',   // Button Hover state
          deep: '#4c3e10',    // Use this for Text on White Backgrounds
        },
        secondary: '#F8F9FA', 
        dark: '#1A1A1A',
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      container: {
        center: true,
        padding: '1.5rem',
      },
    },
  },
  plugins: [],
}