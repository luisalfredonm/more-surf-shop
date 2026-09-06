# More Surf Shop — Web

Sitio web de More Surf Shop, tienda física de surf en Playa Tamarindo, Guanacaste, Costa Rica.

**Stack:** Astro 4 · React 18 (islands) · Tailwind CSS · Supabase (PostgreSQL + RLS) · Vercel · Resend

---

## Estructura

```
src/
├── pages/                       # Rutas (file-based routing)
│   ├── index.astro              # Home
│   ├── surf-lessons-tamarindo.astro   # Página principal indexada
│   ├── surfboard-rental-tamarindo.astro  # Scaffold noindex
│   ├── surf-shop-tamarindo.astro         # Scaffold noindex
│   ├── tours-tamarindo.astro             # Scaffold noindex
│   ├── about.astro                       # Scaffold noindex
│   ├── contact.astro                     # Scaffold noindex
│   ├── sitemap-index.xml.ts     # Sitemap dinámico
│   └── api/leads/create.ts      # Endpoint POST de leads
├── components/
│   ├── layout/                  # Header, Footer, WhatsAppFloat, TrustBar
│   ├── sections/                # Secciones de la landing (13 componentes)
│   ├── seo/                     # JSON-LD (LocalBusiness, Service, FAQPage, Breadcrumb)
│   └── ui/                      # Button, Container, Eyebrow, WhatsAppIcon
├── layouts/BaseLayout.astro
├── data/faqs/                   # FAQs por página (fuente para render + JSON-LD)
├── lib/
│   ├── constants.ts             # Datos del negocio (WhatsApp, dirección, horarios)
│   ├── seo.ts                   # SEO por página (title, description, slug, noindex)
│   ├── supabase.ts              # Cliente + types
│   └── queries/                 # Queries a Supabase con fallbacks
├── styles/global.css            # CSS vars + reset
└── assets/images/               # Imágenes optimizadas por Astro
public/
├── robots.txt
└── (favicon, og-default.jpg, logo.png — pendientes)
supabase/schema.sql              # Schema con RLS
```

---

## Setup local

**Requisitos:** Node 18+, pnpm (o npm).

```bash
# 1. Instalar dependencias
pnpm install

# 2. Copiar variables de entorno
cp .env.example .env

# 3. Editar .env con las credenciales (opcional para desarrollo inicial;
#    las páginas funcionan con datos de fallback si Supabase no está configurado)

# 4. Ejecutar en desarrollo
pnpm dev
# → http://localhost:4321
```

Al abrir `/surf-lessons-tamarindo` sin Supabase configurado, se renderizan los datos de fallback definidos en `src/lib/queries/*` (con placeholders visibles).

---

## Setup de Supabase

1. Crear proyecto en [supabase.com](https://supabase.com).
2. En SQL Editor, ejecutar `supabase/schema.sql`.
3. En SQL Editor, ejecutar `supabase/schema-bookings.sql` (Fase 1: reservas de lecciones + base compartida — `profiles`, `customers`, `waivers`, `payments`, `lesson_slots`, `bookings`, `booking_participants`).
4. Copiar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` a `.env`.
   Copiar también `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (mismos valores; los usa el panel de staff en el browser).
5. Cargar datos reales en `class_types`, `instructors`, `reviews`:
   - Interfaz web de Supabase → Table Editor
   - O usar seeds SQL (ver bloque comentado al final de `schema.sql`)
6. Crear los usuarios del panel de staff (`/staff`):
   - Auth → Users → **Add user** (con contraseña) para el dueño y cada persona de staff.
   - Por cada uno, en SQL Editor:
     `insert into public.profiles (id, display_name, role) values ('<uuid del usuario>', 'Nombre', 'owner');`
     (rol `owner` para el dueño, `staff` para el resto).
   - El panel vive en `/staff` — login con email/contraseña; RLS (`is_staff()`) es lo que restringe el acceso a los datos.

**Importante:** el server usa `SUPABASE_SERVICE_ROLE_KEY` (RLS bypass). Nunca exponer esta clave en el cliente.

---

## Setup de PayPal (Fase 1 — pagos)

El pago del cliente es con PayPal (acepta tarjeta como invitado, sin cuenta). Si las
variables no están, el flujo de reserva cae al handoff por WhatsApp automáticamente.

1. En [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials** → crear una app (empezar en **Sandbox**).
2. Copiar a `.env`:
   - `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET` (de la app)
   - `PUBLIC_PAYPAL_CLIENT_ID` = el **mismo** client id (lo usa el SDK JS del browser)
   - `PAYPAL_ENV=sandbox` (cambiar a `live` con las credenciales de producción)
3. Crear un **webhook** en la misma app apuntando a `https://<dominio>/api/payments/paypal/webhook`, suscrito a:
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.DENIED`.
   Copiar el **Webhook ID** a `PAYPAL_WEBHOOK_ID`.
4. Probar de punta a punta con una cuenta *sandbox buyer* (developer.paypal.com → Sandbox → Accounts).

Endpoints: `create-order` (crea la orden con el monto del servidor), `capture` (captura al
aprobar y confirma la reserva), `webhook` (respaldo asíncrono, verifica la firma). El monto
siempre lo pone el servidor desde `bookings.total_amount` — el cliente no puede alterarlo.

---

## Deploy en Vercel

```bash
# Instalar CLI (una vez)
npm i -g vercel

# Deploy
vercel

# Producción
vercel --prod
```

En el dashboard de Vercel, configurar las mismas variables de entorno que `.env`.

Vercel usa el adapter `@astrojs/vercel/serverless` (SSR) configurado en `astro.config.mjs`.

---

## Checklist de contenido antes de indexar

Antes de quitar `noindex` de cualquier página y de anunciar el sitio, reemplazar los `[PLACEHOLDER]` en:

- [ ] `src/lib/constants.ts` — WhatsApp number, dirección exacta, coords GPS precisas, horarios reales, redes sociales
- [ ] `public/og-default.jpg` — imagen de 1200×630 (foto de la playa/instructor)
- [ ] `public/logo.png` — logo del negocio
- [ ] `public/favicon.svg` + `favicon.png` + `apple-touch-icon.png`
- [ ] Fotos reales en Hero, FamilyKids, Instructors (reemplazar Unsplash placeholders)
- [ ] Datos reales en Supabase: `class_types` (precios), `instructors` (nombres, bios, fotos), `reviews` (quotes reales de Google/TripAdvisor)
- [ ] `src/components/layout/TrustBar.astro` — números reales (students, rating, countries) via `BUSINESS.trust` en constants
- [ ] Métricas de confianza en `BUSINESS.trust` en `constants.ts`
- [ ] Validar el sitio en:
  - [Google Rich Results Test](https://search.google.com/test/rich-results) — LocalBusiness, Service, FAQPage
  - [PageSpeed Insights](https://pagespeed.web.dev/) — LCP < 2.5s
  - [Schema.org Validator](https://validator.schema.org/)

---

## Roadmap

**Fase 1 — SEO landing (actual)**
- ✅ Migración de `surf-lessons-tamarindo` con schemas
- ✅ Formulario de lead + endpoint API + tabla `leads`
- ⏳ Contenido real, fotos, credenciales de Supabase
- ⏳ Integración Resend (email transaccional al admin y confirmación al lead)

**Fase 2 — Reservas y catálogo**
- Sistema de rental de tablas (`rentable_assets` + `rentals`)
- Catálogo de accesorios (`products` con stock)
- Módulo de tours (`tour_types`)

**Fase 3 — Booking end-to-end**
- Pasarela de pago Tilopay (Costa Rica) + PayPal fallback
- Confirmaciones y recordatorios por email
- Panel admin para gestionar contenido

**Fase 4 — App móvil**
- React Native + Expo (monorepo con pnpm workspaces)
- Comparte `@packages/api-client` y `@packages/shared`

---

## Notas técnicas

- **Progressive enhancement:** el LeadForm funciona sin JS (POST tradicional) y con JS hace fetch async.
- **Islands architecture:** React se usa solo si algún componente lo necesita; el 100% del sitio actual es Astro puro (0 KB JS runtime en las secciones estáticas).
- **RLS desde día uno:** las policies protegen contra usos accidentales del anon_key.
- **SEO estructurado:** LocalBusiness siempre presente; Service + FAQPage + Breadcrumb en surf-lessons.
- **Costa Rica payment stack (futuro):** Tilopay como procesador principal, PayPal para tourists, SINPE Móvil para locales. **Stripe NO disponible en CR.**
