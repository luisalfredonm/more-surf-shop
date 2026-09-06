import { getSupabase, isSupabaseConfigured, type DbClassType } from '../supabase';

/**
 * Retorna los tipos de lección disponibles para la página surf-lessons-tamarindo.
 * Si Supabase no está configurado (desarrollo inicial), devuelve fallback
 * con los mismos 3 tipos del HTML original y precios como placeholder.
 */

const FALLBACK_LESSONS: DbClassType[] = [
  {
    id: 'group',
    name: 'Group Surf Lesson',
    category: 'lesson',
    price_per_person: 0, // placeholder — reemplazar por precio real
    ratio_label: 'Up to 4 students per instructor',
    description:
      "Our budget-friendly option and the format most first-timers pick when they want to try surfing without a big commitment. You'll still get personal attention. Tamarindo's waves are forgiving, and 4:1 is small enough that nobody gets forgotten.",
    included: [
      'Soft-top board',
      'Rash guard',
      'ISA-certified instructor',
      'Locker',
      'Freshwater shower',
    ],
    badge: null,
    cta_label: 'Book a Group Lesson',
    active: true,
    sort_order: 1,
    min_guests: 1,
    max_guests: 4,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'semi-private',
    name: 'Semi-Private Surf Lesson',
    category: 'lesson',
    price_per_person: 0,
    ratio_label: '2 or 3 people, one instructor',
    description:
      'Same personal coaching as the private, split between you and your travel partner or two friends. Good sweet spot on price and attention. You cheer each other on, you get individual pointers, no strangers in the mix.',
    included: [
      'Everything in the private, priced per person, up to 3 students per instructor',
    ],
    badge: 'Most Popular',
    cta_label: 'Book a Semi-Private Lesson',
    active: true,
    sort_order: 2,
    min_guests: 2,
    max_guests: 3,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'private',
    name: 'Private Surf Lesson',
    category: 'lesson',
    price_per_person: 0,
    ratio_label: 'One student, one instructor',
    description:
      'The fastest way to progress. Your coach is next to you in the water the whole time, adjusting to your pace, giving you feedback on every wave. Best for adults nervous about the ocean or surfers who already know the basics.',
    included: [
      'Soft-top board',
      'Rash guard',
      'Dedicated instructor',
      'Locker',
      'Freshwater shower',
      'Safety briefing',
    ],
    badge: null,
    cta_label: 'Book a Private Lesson',
    active: true,
    sort_order: 3,
    min_guests: 1,
    max_guests: 1,
    created_at: '',
    updated_at: '',
  },
];

export async function getSurfLessons(): Promise<DbClassType[]> {
  if (!isSupabaseConfigured()) {
    return FALLBACK_LESSONS;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('class_types')
    .select('*')
    .eq('active', true)
    .eq('category', 'lesson')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[getSurfLessons] Supabase error:', error.message);
    return FALLBACK_LESSONS;
  }

  return data && data.length > 0 ? data : FALLBACK_LESSONS;
}
