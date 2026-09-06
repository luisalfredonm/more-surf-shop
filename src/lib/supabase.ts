import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para uso en server (SSR + API routes).
 * Usa service_role_key porque las escrituras las hacemos siempre desde el server
 * (nunca desde el cliente). Las lecturas públicas también van desde el server
 * para mantener el patrón consistente y evitar exponer claves.
 */

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase env vars are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Helper: retorna true si las env vars de Supabase están presentes y no son
 * los placeholders de .env.example. Útil para renderizar fallbacks estáticos
 * durante desarrollo/scaffolding antes de tener credenciales reales.
 */
export function isSupabaseConfigured(): boolean {
  const url = SUPABASE_URL ?? '';
  const key = SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return false;
  // Placeholders de .env.example: 'https://xxxxxxxxxxxxx.supabase.co' y 'eyJhbGci...'
  if (url.includes('xxxx') || key.includes('...')) return false;
  return true;
}

// ============================================
// Types (espejo del schema.sql)
// ============================================

export interface DbClassType {
  id: string;
  name: string;
  category: 'lesson' | 'package' | 'camp';
  price_per_person: number;
  ratio_label: string | null;
  description: string | null;
  included: string[];
  badge: string | null;
  cta_label: string | null;
  active: boolean;
  sort_order: number;
  min_guests: number;
  max_guests: number | null;
  duration_min: number;
  max_capacity: number;
  created_at: string;
  updated_at: string;
}

export interface DbInstructor {
  id: string;
  name: string;
  photo_url: string | null;
  years_teaching: number | null;
  certifications: string[];
  languages: string[];
  bio: string | null;
  favorite_break: string | null;
  personal_detail: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface DbReview {
  id: string;
  author_name: string;
  author_location: string | null;
  source: 'google' | 'tripadvisor' | 'direct';
  rating: number;
  quote: string;
  featured: boolean;
  active: boolean;
  created_at: string;
}

export interface DbLead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  interest: string;              // e.g. 'private', 'group', 'family', 'general'
  preferred_date: string | null; // DATE
  party_size: number | null;
  notes: string | null;
  source_page: string;           // slug de la página que originó el lead
  status: 'new' | 'contacted' | 'converted' | 'lost';
  created_at: string;
}

// ============================================
// Fase 1 — Reservas de lecciones + base compartida
// Espejo de supabase/schema-bookings.sql
// ============================================

export type StaffRole = 'owner' | 'staff';

export interface DbProfile {
  id: string;                    // = auth.users.id
  display_name: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
}

export interface DbCustomer {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  id_type: 'cedula' | 'dimex' | 'passport' | 'other' | null;
  id_number: string | null;
  country_of_residence: string | null;
  address: string | null;
  date_of_birth: string | null;  // DATE
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbWaiver {
  id: string;
  customer_id: string;
  waiver_version: string;
  activity: 'lesson' | 'rental' | 'both';
  signed_at: string;
  signer_name_typed: string;
  accepted_terms: boolean;
  is_minor: boolean;
  guardian_name: string | null;
  ip: string | null;
  user_agent: string | null;
  rendered_text_snapshot: string;
  created_at: string;
}

export type PaymentProvider = 'paypal' | 'sinpe' | 'cash' | 'tilopay';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface DbPayment {
  id: string;
  provider: PaymentProvider;
  provider_ref: string | null;
  amount: number;
  currency: string;              // ISO 4217, 'USD' por defecto
  status: PaymentStatus;
  paid_at: string | null;
  related_type: 'booking' | 'rental_reservation' | 'order';
  related_id: string;            // FK blanda según related_type
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbLessonSlot {
  id: string;
  slot_date: string;             // DATE
  start_time: string;            // TIME 'HH:MM:SS'
  class_type_id: string;
  instructor_id: string | null;
  capacity_total: number;
  status: 'open' | 'closed';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export type PaymentMethod = 'paypal' | 'on_arrival';

export interface DbBookingGroup {
  id: string;
  reference: string;             // p.ej. 'GRP-3F7K2'
  customer_id: string;
  total_amount: number;
  currency: string;
  payment_method: PaymentMethod | null;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;
  created_at: string;
}

export interface DbBooking {
  id: string;
  reference: string;             // p.ej. 'MSS-3F7K2'
  group_id: string | null;
  customer_id: string;
  class_type_id: string;
  slot_id: string | null;
  slot_date: string;             // snapshot DATE
  start_time: string;            // snapshot TIME
  participants_count: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  status: BookingStatus;
  payment_method: PaymentMethod | null;
  payment_id: string | null;
  waiver_id: string | null;
  source: 'web' | 'walk_in' | 'whatsapp' | 'phone';
  customer_note: string | null;
  staff_note: string | null;
  confirmation_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbBookingParticipant {
  id: string;
  booking_id: string;
  full_name: string;
  age: number | null;
  is_minor: boolean;
  weight_kg: number | null;
  height_cm: number | null;
  experience_level: 'first_time' | 'beginner' | 'intermediate' | 'advanced' | null;
  waiver_id: string | null;
  notes: string | null;
  created_at: string;
}
