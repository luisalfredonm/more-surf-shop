/**
 * FAQs — Surf Lessons Tamarindo
 *
 * Fuente única para (a) render en el acordeón visible, (b) generación
 * automática de JSON-LD FAQPage.
 *
 * Formato: pregunta en lenguaje natural + respuesta con estructura
 * bold-lead → detalle → matices, optimizada para featured snippets
 * y respuestas de LLMs (GEO).
 */

export interface FaqItem {
  q: string;
  /**
   * Respuesta en HTML. Debe empezar con <p><strong>...</strong>...</p>
   * para que la primera oración funcione como snippet extractable.
   * Puede incluir <ul><li>, <strong>, <em>, <p>.
   * NO incluir headings, scripts, ni imágenes.
   */
  a: string;
}

export const surfLessonsTamarindoFaqs: FaqItem[] = [
  {
    q: 'Is it worth taking surf lessons in Tamarindo, or is it a waste of vacation money?',
    a: `<p><strong>It's worth it for almost every level of traveler</strong>, and it's one of the highest-return activities you can book in Costa Rica. Tamarindo has warm water year-round, a sandy bottom with no rocks or reef in the beginner zone, and consistent gentle waves that let most first-timers stand up on their first lesson.</p><p>A 90-minute to 2-hour lesson usually costs between $45 and $100 per person depending on the format. Compared to a boat tour or a zipline, you walk away with an actual skill you can keep using, plus photos of yourself surfing on your very first day.</p>`,
  },
  {
    q: 'Tamarindo vs Nosara vs Playa Grande — which is better for beginner surf lessons?',
    a: `<p><strong>For a first-time surfer, Tamarindo is the easiest choice.</strong> Here's the honest breakdown:</p><ul><li><strong>Tamarindo:</strong> Sandy bottom, gentle whitewater, easy town, ideal for beginners with family.</li><li><strong>Nosara (Playa Guiones):</strong> Slightly better waves, more of a wellness scene, harder to reach, more expensive. Better for intermediates.</li><li><strong>Playa Grande:</strong> Beautiful and less crowded, but usually too strong for total beginners.</li></ul><p>If you're bringing family or kids, book in Tamarindo. If you're intermediate wanting to progress, Nosara is worth the travel. Playa Grande is a great day-trip surf destination once you have a few sessions under your belt.</p>`,
  },
  {
    q: 'Should I book surf lessons before I arrive in Tamarindo, or just walk in?',
    a: `<p><strong>Book ahead during peak season, walk in the rest of the year.</strong> Peak season runs mid-December through April, plus Easter week and mid-July to mid-August. During those windows, good surf schools fill up a day or two out.</p><p>The safest move regardless of season is to message us on WhatsApp the day before with your preferred time. Takes 30 seconds, guarantees your instructor, and lets us confirm tide and wave conditions for your slot.</p>`,
  },
  {
    q: "What's a reasonable price for a surf lesson in Tamarindo? I don't want to get ripped off.",
    a: `<p><strong>Expect to pay $45–$100 per person for a 90-min to 2-hour lesson</strong>, depending on the format. Group: $45–$65. Semi-private: $55–$80. Private: $65–$100.</p><p>Anything under $30 is a red flag — the instructor isn't certified, the equipment is bad, or they're going to upsell you mid-lesson. Anything over $120 for a standard beginner lesson is overcharging tourists. Everything included should be transparent before you pay.</p><p>Our prices sit in the middle of the market — fair for what's included, not the cheapest and not trying to be. If you're comparing shops, ask what's included, how many students per instructor, and whether the instructor is certified.</p>`,
  },
  {
    q: 'Should I take a private lesson or is a group lesson fine for beginners?',
    a: `<p><strong>A group lesson is fine for most beginners.</strong> Take a private if any of these apply: you're nervous about the ocean, you're over 45 and want extra pop-up practice on land, you're bringing a kid under 8, you have a physical limitation, or you want to work on a specific skill.</p><p>Group lessons are 4:1 student-to-instructor, small enough that you still get personal attention. Most first-timers here learn in groups and stand up on day one. If you can only take one lesson your whole trip and want to walk away confident, spring for the private.</p>`,
  },
  {
    q: 'Do I need to speak Spanish to take surf lessons in Costa Rica?',
    a: `<p><strong>No. Every instructor at More Surf Shop speaks fluent English.</strong> It's true of most reputable surf schools in Tamarindo — English is the working language on the beach here. You can book and take an entire lesson without knowing a word of Spanish beyond "pura vida."</p><p>Learning "gracias," "por favor," and "buenos días" goes a long way, and locals appreciate it. But it's not a requirement for the lesson.</p>`,
  },
  {
    q: "What's the difference between a surf lesson, surf coaching, and a surf camp?",
    a: `<p><strong>A surf lesson is a single session (90 min to 2 hours) where an instructor teaches you the basics.</strong> Surf coaching is more focused on improving specific technique for someone who already surfs. A surf camp is a multi-day package that usually includes lodging, meals, and daily surf sessions.</p><p>If you already have a hotel or Airbnb in Tamarindo, you don't need a surf camp. Just book lessons directly with a surf school like ours and keep the flexibility of your own accommodation.</p>`,
  },
  {
    q: 'How do I know if a surf school in Tamarindo is legit and not a tourist trap?',
    a: `<p><strong>Legit surf schools have four things in common: a physical shop, certified instructors, transparent pricing online, and a Google Business Profile with dozens of recent reviews.</strong> If any of those are missing, keep looking.</p><ul><li>A real address you can see on Google Maps, not just a WhatsApp number.</li><li>Instructor certifications listed on the website (ISA, ILS, or local credentials).</li><li>Prices clearly published — shops hiding prices behind "contact us" are almost always overcharging.</li><li>A Google Business Profile with 100+ recent reviews and a rating above 4.5.</li></ul><p>More Surf Shop is a physical storefront exactly for these trust reasons. Walk in, meet the staff, see the boards.</p>`,
  },
  {
    q: 'Realistically, will I actually stand up on my first surf lesson?',
    a: `<p><strong>Yes, most first-timers stand up and ride a wave during their first lesson in Tamarindo.</strong> Warm water, waist-deep lesson zone, soft sandy bottom, and gentle rolling whitewater that carries you rather than tumbles you. Your instructor is next to you pushing you into the wave at the right moment.</p><p>That said, standing up and actually surfing are two different things. Standing up on lesson one is realistic. Actually surfing — paddling out on your own, choosing your own waves, riding a real breaking wave — usually takes 3 to 5 lessons across a week.</p>`,
  },
  {
    q: 'How should I plan my Tamarindo trip if I want to learn to surf?',
    a: `<p><strong>Here's the setup that works for most first-timers:</strong></p><ul><li>Give yourself <strong>at least 4 nights</strong> in Tamarindo. Anything less rushes lessons around other activities.</li><li>Book your first lesson for <strong>the morning of your second day</strong>, not your arrival day. Don't surf jet-lagged.</li><li>Book between <strong>7 and 10 AM</strong> — offshore or glassy wind, cooler sun, free afternoon.</li><li>Do lesson 1 as a <strong>private or semi-private</strong>, then drop to group for lessons 2 and 3 if you're on a budget.</li><li>Rent a <strong>soft-top for your rest days</strong>. Practicing on your own between lessons is what makes it stick.</li><li>Save your last morning for a <strong>sunrise session on your own board</strong>. That's the memory you take home.</li></ul>`,
  },
];

/**
 * Helper para strip de HTML — usado por FAQPageSchema para el schema.org
 * (schema.org acepta HTML plano en acceptedAnswer.text, pero suele ser mejor plano)
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
