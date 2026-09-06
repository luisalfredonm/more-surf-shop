/**
 * Constantes del negocio — datos estables que no cambian frecuente.
 * Todo lo dinámico (pricing, instructors, reviews) vive en Supabase.
 *
 * NOTA: los [PLACEHOLDER] se reemplazan cuando los datos reales estén confirmados.
 * Nunca inventar precios, teléfonos, direcciones ni reviews.
 */

export const BUSINESS = {
  name: 'More Surf Shop',
  legalName: 'More Surf Shop', // TODO: reemplazar por razón social si difiere
  tagline: 'Local surf and adventure shop on Tamarindo Beach',
  description:
    'Local, family-run surf shop on Tamarindo Beach. Surf lessons, board rentals, surf trips, tours, and accessories. Bilingual instructors, beginner-friendly waves.',
  foundedYear: 2020, // TODO: confirmar año real de fundación

  // Contacto
  whatsapp: {
    // Número internacional sin +, espacios ni guiones. Ej: 50688881234
    number: import.meta.env.PUBLIC_WHATSAPP_NUMBER || '506XXXXXXXX', // TODO: reemplazar por real
    display: '+506 XXXX-XXXX', // TODO: reemplazar por real
    defaultMessage: 'Hi! I want to book a surf lesson in Tamarindo.',
  },
  email: {
    main: 'hello@moresurfshop.com', // TODO: confirmar
    admin: 'admin@moresurfshop.com',
  },
  phone: '+506 XXXX-XXXX', // TODO: reemplazar por número real

  // Ubicación física
  address: {
    street: 'Playa Tamarindo', // TODO: dirección exacta
    locality: 'Tamarindo',
    region: 'Guanacaste',
    postalCode: '50309',
    country: 'CR',
    countryName: 'Costa Rica',
    formatted: 'Playa Tamarindo, Guanacaste, 50309, Costa Rica',
  },

  // Coordenadas GPS de la tienda (para LocalBusiness schema y Google Maps)
  geo: {
    latitude: 10.2993, // Coordenadas aproximadas de Tamarindo — TODO: precisar con las de la tienda real
    longitude: -85.8407,
  },

  // Horarios (formato ISO 8601 para schema.org)
  // TODO: confirmar horarios reales
  openingHours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], open: '07:00', close: '18:00' },
    { days: ['Saturday', 'Sunday'], open: '07:00', close: '18:00' },
  ],

  // Redes sociales (para schema.org sameAs)
  social: {
    instagram: 'https://instagram.com/moresurfshop', // TODO: verificar
    facebook: 'https://facebook.com/moresurfshop', // TODO: verificar
    tripadvisor: '', // TODO: agregar cuando exista
    googleBusinessProfile: '', // TODO: URL de perfil de GBP
  },

  // Métricas de confianza (mostradas en trust bar)
  // TODO: reemplazar por datos reales una vez validados
  trust: {
    studentsCount: '[X,XXX+]',
    googleRating: '[X.X★]',
    reviewsCount: '[XXX]',
    countriesVisited: '[XX+]',
    bilingualInstructors: '100%',
  },
} as const;

export const SITE = {
  url: import.meta.env.PUBLIC_SITE_URL || 'https://moresurfshop.com',
  locale: 'en_US',
  defaultOgImage: '/og-default.jpg',
};

/**
 * Helper para construir URL de WhatsApp con mensaje prefilled
 */
export function whatsappUrl(message?: string): string {
  const text = encodeURIComponent(message || BUSINESS.whatsapp.defaultMessage);
  return `https://wa.me/${BUSINESS.whatsapp.number}?text=${text}`;
}

/**
 * Helper para construir URL absoluta desde slug
 */
export function absoluteUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${SITE.url}${cleanPath}`;
}
