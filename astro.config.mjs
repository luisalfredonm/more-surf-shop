// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel/serverless';

// https://astro.build/config
export default defineConfig({
  site: 'https://moresurfshop.com', // TODO: reemplazar por el dominio real cuando esté
  output: 'server',
  adapter: vercel({
    imageService: true,
    webAnalytics: { enabled: true },
  }),
  integrations: [
    tailwind({
      applyBaseStyles: false, // usamos nuestro propio global.css con tokens
    }),
    react(),
  ],
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
  prefetch: {
    defaultStrategy: 'hover',
  },
  redirects: {
    // Redirects 301 para consolidar URLs si en algún momento hay variantes
    '/lessons': '/surf-lessons-tamarindo',
    '/surf-lessons': '/surf-lessons-tamarindo',
    '/book': '/surf-lessons-tamarindo#book',
  },
  vite: {
    ssr: {
      noExternal: ['@supabase/supabase-js'],
    },
  },
});
