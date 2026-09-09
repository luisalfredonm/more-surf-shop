/**
 * Datos SEO centralizados por página.
 * Cada página del sitio debe tener una entrada en `seoData`.
 * SEOHead.astro consume este objeto para generar meta tags y canonical.
 */

export interface PageSeo {
  slug: string;              // URL canónica (sin dominio, sin trailing slash)
  keyfocus: string;          // Keyword principal que ataca la página
  title: string;             // <title>
  description: string;       // meta description (150-160 chars)
  ogImage?: string;          // imagen específica de Open Graph (fallback a defaultOgImage)
  synonyms?: string[];       // keywords relacionadas (para linking interno y research)
  related?: string[];        // páginas relacionadas para linking interno
  noindex?: boolean;         // true para scaffolds y páginas sin contenido
}

export const seoData: Record<string, PageSeo> = {
  home: {
    slug: '/',
    keyfocus: 'surf shop tamarindo',
    title: 'Surf Shop in Tamarindo, Costa Rica | More Surf Shop',
    description:
      'Local surf shop on Tamarindo Beach: surf lessons, board rentals, surf trips, tours, and accessories. Bilingual staff, walk in or WhatsApp.',
    synonyms: ['tamarindo surf shop', 'surf store tamarindo', 'surf gear tamarindo'],
    related: ['surf-lessons-tamarindo', 'surfboard-rental-tamarindo'],
  },

  'surf-lessons-tamarindo': {
    slug: '/surf-lessons-tamarindo',
    keyfocus: 'surf lessons tamarindo',
    title: 'Surf Lessons in Tamarindo, Costa Rica | More Surf Shop',
    description:
      'Local, family-run surf school on Tamarindo Beach. Bilingual instructors, beginner-friendly waves, and everything included. Book your surf lesson today.',
    synonyms: [
      'surf lessons tamarindo costa rica',
      'tamarindo surf school',
      'learn to surf tamarindo',
      'surf classes tamarindo',
      'beginner surf lessons tamarindo',
      'family surf lessons tamarindo',
      'private surf lesson tamarindo',
    ],
    related: ['surfboard-rental-tamarindo', 'tours-tamarindo'],
  },

  'surfboard-rental-tamarindo': {
    slug: '/surfboard-rental-tamarindo',
    keyfocus: 'surfboard rental tamarindo',
    title: 'Surfboard Rental in Tamarindo | More Surf Shop',
    description:
      'Rent surfboards in Tamarindo, Costa Rica. Softtops, longboards, funboards, shortboards. Daily and weekly rates. Walk in or reserve on WhatsApp.',
    synonyms: [
      'surfboard rental tamarindo',
      'rent a surfboard tamarindo',
      'longboard rental tamarindo',
      'softboard rental tamarindo',
      'surfboard hire tamarindo',
      'daily surfboard rental tamarindo',
    ],
    related: ['surf-lessons-tamarindo', 'surf-shop-tamarindo'],
  },

  'surf-shop-tamarindo': {
    slug: '/surf-shop-tamarindo',
    keyfocus: 'surf shop tamarindo accessories',
    title: 'Surf Accessories & Gear in Tamarindo | More Surf Shop',
    description:
      'Surf accessories in Tamarindo, Costa Rica: wax, leashes, fins, rash guards, reef-safe sunscreen and board bags. See what we stock, pick up at the shop.',
    synonyms: [
      'surf accessories tamarindo',
      'surf gear tamarindo',
      'surf wax tamarindo',
      'surfboard leash tamarindo',
      'reef safe sunscreen tamarindo',
      'rash guard tamarindo',
    ],
    related: ['surfboard-rental-tamarindo', 'surf-lessons-tamarindo'],
  },

  'tours-tamarindo': {
    slug: '/tours-tamarindo',
    keyfocus: 'tours tamarindo',
    title: 'Tours in Tamarindo & Guanacaste | More Surf Shop',
    description:
      'Book tours in Tamarindo and Guanacaste: sport fishing, catamaran, estuary boat tours, surf trips, wildlife adventures. Local team, WhatsApp booking.',
    synonyms: [
      'tours tamarindo',
      'things to do tamarindo',
      'tamarindo activities',
      'catamaran tour tamarindo',
      'sport fishing tamarindo',
    ],
    related: ['surf-lessons-tamarindo', 'surfboard-rental-tamarindo'],
    noindex: true,
  },

  about: {
    slug: '/about',
    keyfocus: 'about more surf shop tamarindo',
    title: 'About More Surf Shop | Tamarindo, Costa Rica',
    description:
      'A local surf and adventure shop on Tamarindo Beach. Bilingual team, born and raised in Guanacaste. Meet the people behind More Surf Shop.',
    related: ['surf-lessons-tamarindo'],
    noindex: true,
  },

  'reserva-tienda': {
    slug: '/reserva-tienda',
    keyfocus: 'surf shop tamarindo order',
    title: 'Your order | More Surf Shop',
    description:
      'Review your order and pick it up at our shop on Playa Tamarindo, Costa Rica.',
    noindex: true, // checkout step
  },

  reservation: {
    slug: '/reservation',
    keyfocus: 'surfboard rental reservation tamarindo',
    title: 'Your reservation | More Surf Shop',
    description:
      'Review your rental dates and boards before you confirm at More Surf Shop, Tamarindo.',
    noindex: true, // checkout step
  },

  booking: {
    slug: '/booking',
    keyfocus: 'check surf lesson booking tamarindo',
    title: 'Check your booking | More Surf Shop',
    description:
      'Look up your More Surf Shop booking with your code and email. Date, time, status and payment.',
    noindex: true,
  },

  contact: {
    slug: '/contact',
    keyfocus: 'contact more surf shop tamarindo',
    title: 'Contact & Location | More Surf Shop Tamarindo',
    description:
      'Visit our shop on Tamarindo Beach or reach us on WhatsApp. Directions, hours, and how to find us.',
    related: ['surf-lessons-tamarindo'],
    noindex: true,
  },
};

/**
 * Helper para obtener datos SEO de una página por slug.
 * Devuelve undefined si el slug no existe.
 */
export function getPageSeo(slug: string): PageSeo | undefined {
  const key = slug.replace(/^\//, '') || 'home';
  return seoData[key];
}
