/**
 * FAQs — Surfboard Rental Tamarindo
 * Fuente única para el acordeón visible y el JSON-LD FAQPage.
 * Respuestas en HTML, empezando con <p><strong>…</strong>…</p>.
 */
import type { FaqItem } from './surf-lessons-tamarindo';

export const surfboardRentalTamarindoFaqs: FaqItem[] = [
  {
    q: 'How much does it cost to rent a surfboard in Tamarindo?',
    a: '<p><strong>Rentals are priced by the hour, by the day, or by the week.</strong> Soft-tops are the cheapest, longboards and performance boards a little more. You see the exact total for your dates before you book — pick a board type and duration on the form above and the price updates.</p>',
  },
  {
    q: 'Do I need to reserve a board in advance, or can I just walk in?',
    a: '<p><strong>Both work.</strong> You can reserve a specific board online and pay now or at the shop, or just walk into our shop on Tamarindo Beach and we\'ll set you up with whatever\'s free. Reserving ahead guarantees the board you want on busy weeks.</p>',
  },
  {
    q: 'What do I need to bring to pick up a rental board?',
    a: '<p><strong>Photo ID and a card for the security deposit.</strong> We take a card imprint as a deposit against damage or loss — it\'s released when you bring the board back in the same condition. You also sign a short rental waiver at the counter. Fins and a leash are included.</p>',
  },
  {
    q: 'Which surfboard should I rent if I\'m a beginner?',
    a: '<p><strong>A soft-top, 7\'0 to 8\'0.</strong> Foam boards are stable, float well, and don\'t hurt if they hit you. If you\'ve had a few lessons and can stand up, a longboard or funboard is the natural next step. Tell us your level at the shop and we\'ll match you.</p>',
  },
  {
    q: 'What happens if the board gets dinged while I have it?',
    a: '<p><strong>Small dings happen — tell us at return and we\'ll assess it.</strong> Minor wear is normal and not charged. A repairable ding has a fixed repair fee; a snapped board or lost fins are charged against the deposit. We photograph every board at pickup and return so it\'s clear what happened on your rental.</p>',
  },
  {
    q: 'Can I keep the board overnight or for several days?',
    a: '<p><strong>Yes — daily and weekly rates are built for multi-day trips.</strong> The weekly rate is seven times the daily rate, so a full week costs the same whether you book it as 7 days or as 1 week. Longer than that, message us and we\'ll sort a rate.</p>',
  },
];
