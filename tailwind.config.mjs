/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        // Tokens exactos del diseño original
        navy: {
          DEFAULT: '#0A2540',
          dark: '#061A2E',
        },
        teal: {
          DEFAULT: '#14B8A6',
          dark: '#0F9488',
        },
        sunset: {
          DEFAULT: '#F97316',
          dark: '#EA580C',
        },
        cream: {
          DEFAULT: '#FDF8F0',  // bg principal
          alt: '#F5EEE0',      // bg alterno de secciones
        },
        ink: {
          DEFAULT: '#1F2937',  // texto principal
          muted: '#6B7280',    // texto secundario
        },
        border: {
          DEFAULT: '#E5DECD',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Escalas fluidas del diseño original mantenidas como clases
        'h1': 'clamp(2.5rem, 5vw + 1rem, 4.5rem)',
        'h2': 'clamp(2rem, 3vw + 1rem, 3rem)',
      },
      boxShadow: {
        'sm-brand': '0 1px 2px rgba(10, 37, 64, 0.05)',
        'md-brand': '0 4px 20px rgba(10, 37, 64, 0.08)',
        'lg-brand': '0 20px 60px rgba(10, 37, 64, 0.15)',
      },
      borderRadius: {
        'brand': '12px',
        'brand-sm': '8px',
      },
      maxWidth: {
        'container': '1200px',
      },
      spacing: {
        'section': '6rem',
        'section-mobile': '3.5rem',
      },
    },
  },
  plugins: [],
};
