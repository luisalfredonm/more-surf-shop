import { getSupabase, isSupabaseConfigured, type DbReview } from '../supabase';

const FALLBACK_REVIEWS: DbReview[] = [
  {
    id: 'r1',
    author_name: 'Sarah M.',
    author_location: 'Toronto, Canada',
    source: 'google',
    rating: 5,
    quote:
      '[Real quote from a verified Google or TripAdvisor review. Keep under 40 words. Should mention specific instructor name, wave outcome, or a concrete detail.]',
    featured: true,
    active: true,
    created_at: '',
  },
  {
    id: 'r2',
    author_name: 'Jennifer P.',
    author_location: 'Austin, USA',
    source: 'google',
    rating: 5,
    quote:
      '[Real quote from a family or parent traveler. Ideally mentions kids by outcome, or highlights bilingual instruction.]',
    featured: true,
    active: true,
    created_at: '',
  },
  {
    id: 'r3',
    author_name: 'Michael R.',
    author_location: 'London, UK',
    source: 'tripadvisor',
    rating: 5,
    quote:
      '[Real quote about the shop, the location, or the overall experience. Something a nervous first-timer would relate to.]',
    featured: true,
    active: true,
    created_at: '',
  },
  {
    id: 'r4',
    author_name: 'Ashley K.',
    author_location: 'Vancouver, Canada',
    source: 'google',
    rating: 5,
    quote:
      '[Real quote from a returning customer or someone comparing to other Tamarindo schools.]',
    featured: true,
    active: true,
    created_at: '',
  },
];

export interface ReviewsWithStats {
  reviews: DbReview[];
  aggregate: {
    ratingValue: number;   // promedio (ej. 4.9)
    reviewCount: number;   // total (ej. 217)
    bestRating: 5;
    worstRating: 1;
  } | null;
}

export async function getFeaturedReviews(): Promise<ReviewsWithStats> {
  if (!isSupabaseConfigured()) {
    return {
      reviews: FALLBACK_REVIEWS,
      aggregate: null, // no emitir AggregateRating hasta tener datos reales
    };
  }

  const supabase = getSupabase();
  const [{ data: featured, error: featuredErr }, { data: stats, error: statsErr }] =
    await Promise.all([
      supabase
        .from('reviews')
        .select('*')
        .eq('active', true)
        .eq('featured', true)
        .order('created_at', { ascending: false })
        .limit(4),
      supabase.rpc('get_reviews_aggregate'), // función que retorna { avg_rating, total_count }
    ]);

  if (featuredErr) console.error('[getFeaturedReviews] featured error:', featuredErr.message);
  if (statsErr) console.error('[getFeaturedReviews] stats error:', statsErr.message);

  const reviews = featured && featured.length > 0 ? featured : FALLBACK_REVIEWS;

  const aggregate = stats
    ? {
        ratingValue: Number(stats.avg_rating),
        reviewCount: Number(stats.total_count),
        bestRating: 5 as const,
        worstRating: 1 as const,
      }
    : null;

  return { reviews, aggregate };
}
