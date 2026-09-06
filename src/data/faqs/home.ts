/**
 * FAQs — Home (More Surf Shop, Tamarindo)
 *
 * Fuente única para (a) render en el acordeón visible de la home,
 * (b) generación automática de JSON-LD FAQPage.
 *
 * Mismo formato que surf-lessons-tamarindo: pregunta natural + respuesta
 * HTML que empieza con <p><strong>…</strong>…</p> para que la primera
 * oración funcione como snippet extractable (featured snippets + GEO).
 *
 * NOTA: los [PLACEHOLDER] (dirección, horarios) se reemplazan cuando los
 * datos reales estén confirmados. Ver checklist en README.
 */

import type { FaqItem } from './surf-lessons-tamarindo';

export const homeFaqs: FaqItem[] = [
  {
    q: 'What does More Surf Shop actually offer?',
    a: `<p><strong>Everything a traveler needs to surf and explore Tamarindo, all in one shop.</strong> Surf lessons for every level (private, semi-private, group, kids, family), surfboard rentals by the hour or the week, guided surf trips to other Guanacaste beaches like Playa Grande and Avellanas, and Tamarindo tours including sport fishing, catamaran sails, estuary boat tours, and horseback riding.</p><p>We also stock the accessories you inevitably forget: leashes, wax, rash guards, reef-safe sunscreen, waterproof pouches, bikinis, board bags, and beach hats.</p>`,
  },
  {
    q: 'Do I need to book online before I arrive, or can I just walk in?',
    a: `<p><strong>Walk-ins are always welcome. Booking ahead is smart during peak season.</strong> Peak in Tamarindo runs mid-December to April, plus Easter week and mid-July to mid-August. During those windows, lessons and popular tours fill up a day or two out.</p><p>Off-peak, you can usually walk in and get what you want same-day. The safest move regardless of season: send us a WhatsApp with your dates the day you arrive, and we'll confirm availability in minutes.</p>`,
  },
  {
    q: 'Where exactly is the shop located in Tamarindo?',
    a: `<p><strong>[Full address], right in front of Tamarindo's main beach break.</strong> A few minutes' walk from the town center and easy to reach on foot from any hotel in central Tamarindo.</p><p>You can find us on Google Maps as "More Surf Shop, Tamarindo." If you're arriving from Liberia Airport (LIR), it's about a 75-minute drive. Most hotels can arrange a shuttle, or ask us and we'll help you sort transport.</p>`,
  },
  {
    q: 'Can I rent a board without taking a lesson?',
    a: `<p><strong>Yes, absolutely.</strong> Board rentals are open to anyone who's comfortable in the water — no lesson required. We ask a few questions about your level to match you with the right board (soft-top, funboard, or shortboard), and you're on your way.</p><p>If you're not sure about your level or the conditions that day, we'll give you an honest read before you rent. Better to steer you toward a lesson on day one and rentals for the rest of the week than to send you out on a board you're not ready for.</p>`,
  },
  {
    q: "What's the best way to contact you and how fast do you reply?",
    a: `<p><strong>WhatsApp is fastest — usually a few minutes during shop hours.</strong> Email works too but expect a longer wait. Instagram DMs get seen, but WhatsApp is where we live.</p><p>If you're already in Tamarindo, walking into the shop is the easiest way to sort out anything complicated — bundle discounts, unusual requests, or last-minute changes are all faster face-to-face.</p>`,
  },
  {
    q: 'Does your team speak English?',
    a: `<p><strong>Yes. Every member of our team speaks fluent English.</strong> You don't need any Spanish to book, take a lesson, rent a board, or plan a whole trip with us.</p><p>That said, locals in Costa Rica appreciate when travelers try even a few words. "Pura vida," "gracias," and "buenos días" go a long way.</p>`,
  },
  {
    q: 'Can I pay with a credit card, or do I need cash?',
    a: `<p><strong>We accept credit and debit cards (Visa and Mastercard), SINPE Móvil for local transfers, PayPal for international payments, and cash in USD or colones.</strong> No hidden processing fees on card payments.</p><p>For online bookings ahead of your trip, we handle payment via secure Costa Rican payment processors or PayPal — whichever works better for your bank.</p>`,
  },
  {
    q: 'What are your hours and are you open year-round?',
    a: `<p><strong>We're open every day, year-round, from [opening time] to [closing time].</strong> We only close for a couple of major holidays (Christmas Day and New Year's Day). The shop is busiest between 7 and 10 AM (lesson prime time) and 4 to 6 PM (sunset gear runs).</p><p>Lessons run throughout the day depending on tide — the best window varies by season. Message us with your dates and we'll recommend the best times to book.</p>`,
  },
  {
    q: 'Do you offer discounts if I book multiple services or a longer trip?',
    a: `<p><strong>Yes.</strong> Multi-lesson packages (3, 5, 7 days) save money versus booking single lessons. Weekly and monthly board rentals cost less per day than daily rentals. And if you're bundling lessons, rentals, and a tour, tell us and we'll build a custom trip package with a better all-in price.</p><p>Longer stays (digital nomads, month-long trips) get special monthly rental pricing on boards — ask us about that specifically.</p>`,
  },
  {
    q: 'When is the best time to visit Tamarindo?',
    a: `<p><strong>Any time of year is good — Tamarindo works year-round.</strong> <strong>Dry season (December–April)</strong> is sunniest, most popular, and has warmer air. <strong>Green season (May–November)</strong> brings bigger waves, quick afternoon rain showers, fewer crowds, and often cheaper hotels.</p><p>For beginner surfers, dry season is easier. For intermediates chasing bigger waves, green season is better. Water temperature stays 78–84°F (26–29°C) all year regardless.</p>`,
  },
];
