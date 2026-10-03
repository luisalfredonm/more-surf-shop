// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import icon from 'astro-icon';
import vercel from '@astrojs/vercel';

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
    // Phosphor (@iconify-json/ph). Una sola familia de iconos en todo el proyecto.
    icon({ iconDir: 'src/icons' }),
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
    // El panel de staff es client:only, y el escáner de Vite no lo recorre al
    // arrancar: descubría estas dependencias recién al abrir /staff, volvía a
    // optimizar y los imports ya compilados quedaban apuntando al hash viejo
    // (504 "Outdated Optimize Dep" -> QR Stickers sin QR hasta reiniciar).
    // Declaradas acá se pre-empaquetan desde el arranque.
    optimizeDeps: {
      include: ['@supabase/supabase-js', 'qrcode-generator', 'jsqr', 'react-dom'],
    },
    ssr: {
      noExternal: ['@supabase/supabase-js'],
    },
  },
});
