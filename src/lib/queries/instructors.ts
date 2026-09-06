import { getSupabase, isSupabaseConfigured, type DbInstructor } from '../supabase';

const FALLBACK_INSTRUCTORS: DbInstructor[] = [
  {
    id: 'instructor-1',
    name: '[Instructor Name 1]',
    photo_url: null,
    years_teaching: null,
    certifications: ['ISA-certified'],
    languages: ['English', 'Spanish'],
    bio: 'Grew up in [Guanacaste town] surfing Tamarindo Beach. Known for staying calm with nervous first-timers and getting kids on their feet by wave three.',
    favorite_break: '[break]',
    personal_detail: '[personal detail]',
    active: true,
    sort_order: 1,
    created_at: '',
  },
  {
    id: 'instructor-2',
    name: '[Instructor Name 2]',
    photo_url: null,
    years_teaching: null,
    certifications: ['First-aid trained'],
    languages: ['English', 'Spanish'],
    bio: '[Brief personal background — where they learned to surf, years in Tamarindo, teaching philosophy].',
    favorite_break: '[break]',
    personal_detail: '[personal detail]',
    active: true,
    sort_order: 2,
    created_at: '',
  },
  {
    id: 'instructor-3',
    name: '[Instructor Name 3]',
    photo_url: null,
    years_teaching: null,
    certifications: ['Family specialist'],
    languages: ['English', 'Spanish'],
    bio: '[Brief personal background]. Loves teaching families and kids. Patient, calm, gets even the most nervous students smiling by the end of session one.',
    favorite_break: '[break]',
    personal_detail: '[personal detail]',
    active: true,
    sort_order: 3,
    created_at: '',
  },
];

export async function getInstructors(): Promise<DbInstructor[]> {
  if (!isSupabaseConfigured()) return FALLBACK_INSTRUCTORS;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('instructors')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[getInstructors] Supabase error:', error.message);
    return FALLBACK_INSTRUCTORS;
  }
  return data && data.length > 0 ? data : FALLBACK_INSTRUCTORS;
}
