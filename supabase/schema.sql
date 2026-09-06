-- ============================================
-- More Surf Shop — Schema SQL
-- Ejecutar en Supabase SQL Editor tras crear el proyecto.
-- Idempotente: puede reejecutarse sin duplicar.
-- ============================================

-- Habilitar extensión de UUID
create extension if not exists "uuid-ossp";

-- ============================================
-- Tabla: class_types (tipos de lecciones/paquetes/campamentos)
-- ============================================
create table if not exists public.class_types (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null check (category in ('lesson', 'package', 'camp')),
  price_per_person numeric(10, 2) not null default 0,
  ratio_label text,
  description text,
  included text[] not null default '{}',
  badge text,
  cta_label text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_types_active_sort
  on public.class_types(active, sort_order) where active = true;
create index if not exists idx_class_types_category
  on public.class_types(category);

-- ============================================
-- Tabla: instructors
-- ============================================
create table if not exists public.instructors (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  photo_url text,
  years_teaching integer,
  certifications text[] not null default '{}',
  languages text[] not null default '{"English","Spanish"}',
  bio text,
  favorite_break text,
  personal_detail text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_instructors_active_sort
  on public.instructors(active, sort_order) where active = true;

-- ============================================
-- Tabla: reviews
-- ============================================
create table if not exists public.reviews (
  id uuid primary key default uuid_generate_v4(),
  author_name text not null,
  author_location text,
  source text not null check (source in ('google', 'tripadvisor', 'direct')),
  rating numeric(2, 1) not null check (rating >= 1 and rating <= 5),
  quote text not null,
  featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_featured_active
  on public.reviews(featured, active) where featured = true and active = true;

-- ============================================
-- Tabla: leads (booking requests desde el formulario)
-- ============================================
create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null,
  phone text,
  country text,
  interest text not null,
  preferred_date date,
  party_size integer check (party_size >= 1 and party_size <= 20),
  notes text,
  source_page text not null default '/',
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'lost')),
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_created_at on public.leads(created_at desc);
create index if not exists idx_leads_status on public.leads(status);

-- ============================================
-- Función: aggregate rating para AggregateRating schema
-- ============================================
create or replace function public.get_reviews_aggregate()
returns table(avg_rating numeric, total_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    round(avg(rating)::numeric, 1) as avg_rating,
    count(*)::bigint as total_count
  from public.reviews
  where active = true;
$$;

-- ============================================
-- Trigger: actualizar updated_at automáticamente
-- ============================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_class_types_updated_at on public.class_types;
create trigger trg_class_types_updated_at
  before update on public.class_types
  for each row execute function public.set_updated_at();

-- ============================================
-- Row-Level Security
-- Todas las tablas: lectura pública para datos que van a la web,
-- escrituras solo por service_role_key (usado desde el server).
-- ============================================

alter table public.class_types enable row level security;
alter table public.instructors enable row level security;
alter table public.reviews enable row level security;
alter table public.leads enable row level security;

-- class_types: lectura pública de activos
drop policy if exists "class_types_public_read" on public.class_types;
create policy "class_types_public_read"
  on public.class_types
  for select
  using (active = true);

-- instructors: lectura pública de activos
drop policy if exists "instructors_public_read" on public.instructors;
create policy "instructors_public_read"
  on public.instructors
  for select
  using (active = true);

-- reviews: lectura pública de activos
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
  on public.reviews
  for select
  using (active = true);

-- leads: NO hay política SELECT pública (solo service_role puede leer)
-- INSERT tampoco público — solo desde el server con service_role

-- Nota: al usar service_role_key desde el server, RLS se bypassa automáticamente.
-- Estas policies protegen contra usos accidentales del anon_key en el cliente.

-- ============================================
-- Seeds mínimos (opcional — comentar si no querés datos de ejemplo)
-- ============================================
-- Descomentar para insertar datos de ejemplo para desarrollo.
-- Reemplazar por datos reales antes de producción.
/*
insert into public.class_types (name, category, price_per_person, ratio_label, description, included, badge, cta_label, sort_order)
values
  ('Group Surf Lesson', 'lesson', 55, 'Up to 4 students per instructor',
   'Budget-friendly and social. Small ratio, personal attention, forgiving waves.',
   array['Soft-top board', 'Rash guard', 'ISA-certified instructor', 'Locker', 'Freshwater shower'],
   null, 'Book a Group Lesson', 1),
  ('Semi-Private Surf Lesson', 'lesson', 70, '2 or 3 people, one instructor',
   'Same personal coaching as the private, split between you and your travel partner.',
   array['Everything in the private, priced per person'],
   'Most Popular', 'Book a Semi-Private Lesson', 2),
  ('Private Surf Lesson', 'lesson', 90, 'One student, one instructor',
   'Fastest way to progress. Dedicated instructor beside you the entire session.',
   array['Soft-top board', 'Rash guard', 'Dedicated instructor', 'Locker', 'Freshwater shower', 'Safety briefing'],
   null, 'Book a Private Lesson', 3);
*/
