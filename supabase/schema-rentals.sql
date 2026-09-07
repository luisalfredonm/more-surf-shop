-- ============================================
-- More Surf Shop — Schema SQL · Fase 2: Rentals de tablas
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql y schema-bookings.sql.
-- Idempotente: puede reejecutarse sin duplicar.
--
-- Reusa de schema-bookings.sql: customers, payments, waivers, booking_groups,
-- profiles, is_staff(), set_updated_at().
--
-- Modelo:
--   board_models   — specs + tarifas compartidas (lo que agrupa a las tablas iguales)
--   board_units    — la tabla física reservable (el `code` = nº de la hoja de papel + QR)
--   rentals        — un alquiler; cada fila es una línea de la "hoja de vida" de la unidad
--   rental_settings — config editable por el staff (duración, presets, antelación)
--
-- Online se reserva la UNIDAD exacta. El depósito NO lo toca el sistema
-- (copia de tarjeta en el mostrador).
-- ============================================

create extension if not exists "uuid-ossp";

-- Redeclarada para que este archivo corra de forma independiente.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================
-- Tabla: board_models (specs + tarifas — se comparten entre tablas iguales)
-- ============================================
create table if not exists public.board_models (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  category text not null
    check (category in ('softtop', 'longboard', 'funboard', 'shortboard', 'fish', 'sup')),
  length_label text,                       -- "6'2", "9'0"
  volume_l numeric(5, 1),
  skill_level text not null default 'all'
    check (skill_level in ('beginner', 'intermediate', 'advanced', 'all')),
  description text,
  image_urls text[] not null default '{}',
  price_per_hour numeric(10, 2) not null default 0,
  price_per_day numeric(10, 2) not null default 0,
  -- semana = price_per_day * 7 (calculado en la app; sin columna)
  active boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_board_models_active_sort
  on public.board_models (active, sort_order) where active = true;
create index if not exists idx_board_models_category on public.board_models (category);

drop trigger if exists trg_board_models_updated_at on public.board_models;
create trigger trg_board_models_updated_at
  before update on public.board_models
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: board_units (inventario físico reservable — la "hoja de vida")
-- `code` es el número de tabla de la hoja de papel y del sticker QR.
-- ============================================
create table if not exists public.board_units (
  id uuid primary key default uuid_generate_v4(),
  model_id uuid not null references public.board_models(id) on delete restrict,
  code text not null unique,               -- "6.2 Ap"
  nickname text,
  photo_url text,
  default_fins integer not null default 3 check (default_fins >= 0 and default_fins <= 6),
  status text not null default 'available'
    check (status in ('available', 'maintenance', 'retired')),
  condition_notes text,
  acquired_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_board_units_model on public.board_units (model_id);
create index if not exists idx_board_units_status on public.board_units (status);

drop trigger if exists trg_board_units_updated_at on public.board_units;
create trigger trg_board_units_updated_at
  before update on public.board_units
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: rentals (un alquiler de una unidad; pertenece a un booking_group)
-- Flujo:
--   web + paypal      -> pending_payment --(capturado)--> confirmed --> picked_up --> returned
--   web + on_arrival  -> confirmed de una (paga al retirar)
--   walk_in           -> picked_up de una (el staff lo registra al entregar)
-- Disponibilidad bloquea: confirmed + picked_up + pending_payment de los últimos ~20 min.
-- ============================================
create table if not exists public.rentals (
  id uuid primary key default uuid_generate_v4(),
  reference text not null unique,                 -- 'RNT-XXXXX'
  group_id uuid references public.booking_groups(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  unit_id uuid not null references public.board_units(id) on delete restrict,
  model_id uuid not null references public.board_models(id) on delete restrict,  -- snapshot
  start_at timestamptz not null,                  -- retiro
  end_at timestamptz not null,                    -- devolución prevista
  rate_type text not null check (rate_type in ('hour', 'day', 'week')),
  units_billed integer not null check (units_billed >= 1),
  unit_price numeric(10, 2) not null,             -- snapshot de la tarifa aplicada
  total_amount numeric(10, 2) not null default 0,
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'picked_up', 'returned', 'cancelled', 'no_show')),
  payment_method text check (payment_method in ('paypal', 'on_arrival', 'cash')),
  payment_id uuid references public.payments(id) on delete set null,
  waiver_id uuid references public.waivers(id) on delete set null,
  source text not null default 'web' check (source in ('web', 'walk_in', 'whatsapp', 'phone')),
  -- chequeo de condición (reemplaza dings/fins de la hoja) — foto desde v1
  fins_out integer check (fins_out >= 0 and fins_out <= 6),
  condition_out_photo_url text,
  condition_out_notes text,
  fins_in integer check (fins_in >= 0 and fins_in <= 6),
  condition_in_photo_url text,
  condition_in_notes text,
  damage_reported boolean not null default false,
  damage_fee numeric(10, 2),
  picked_up_at timestamptz,
  returned_at timestamptz,
  checked_out_by uuid references public.profiles(id) on delete set null,
  checked_in_by uuid references public.profiles(id) on delete set null,
  customer_note text,
  staff_note text,
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rentals_range_ok check (end_at > start_at)
);

create index if not exists idx_rentals_unit_start on public.rentals (unit_id, start_at);
create index if not exists idx_rentals_status_start on public.rentals (status, start_at);
create index if not exists idx_rentals_group on public.rentals (group_id);
create index if not exists idx_rentals_customer on public.rentals (customer_id);
create index if not exists idx_rentals_out_now on public.rentals (end_at)
  where status = 'picked_up';
create index if not exists idx_rentals_pending_created on public.rentals (created_at)
  where status = 'pending_payment';

drop trigger if exists trg_rentals_updated_at on public.rentals;
create trigger trg_rentals_updated_at
  before update on public.rentals
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: rental_settings (fila única — la edita el staff)
-- Lectura pública: el widget online necesita los presets y la antelación.
-- ============================================
create table if not exists public.rental_settings (
  id smallint primary key default 1 check (id = 1),
  min_duration_hours integer not null default 1 check (min_duration_hours >= 1),
  max_duration_days integer not null default 30 check (max_duration_days >= 1),
  min_lead_hours integer not null default 0 check (min_lead_hours >= 0),
  min_charge_unit text not null default 'hour' check (min_charge_unit in ('hour', 'day')),
  duration_presets jsonb not null default
    '[{"label":"2 h","kind":"hour","qty":2},
      {"label":"4 h","kind":"hour","qty":4},
      {"label":"1 día","kind":"day","qty":1},
      {"label":"2 días","kind":"day","qty":2},
      {"label":"1 semana","kind":"week","qty":1}]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.rental_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_rental_settings_updated_at on public.rental_settings;
create trigger trg_rental_settings_updated_at
  before update on public.rental_settings
  for each row execute function public.set_updated_at();

-- ============================================
-- Row-Level Security
-- board_models / rental_settings: lectura pública (catálogo + widget).
-- board_units / rentals: staff-only. La disponibilidad pública se sirve por las
-- funciones security definer de abajo, no por acceso directo.
-- ============================================
alter table public.board_models enable row level security;
alter table public.board_units enable row level security;
alter table public.rentals enable row level security;
alter table public.rental_settings enable row level security;

drop policy if exists "board_models_public_read" on public.board_models;
create policy "board_models_public_read" on public.board_models
  for select using (active = true);

drop policy if exists "board_models_staff_all" on public.board_models;
create policy "board_models_staff_all" on public.board_models
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "board_units_staff_all" on public.board_units;
create policy "board_units_staff_all" on public.board_units
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "rentals_staff_all" on public.rentals;
create policy "rentals_staff_all" on public.rentals
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "rental_settings_public_read" on public.rental_settings;
create policy "rental_settings_public_read" on public.rental_settings
  for select using (true);

drop policy if exists "rental_settings_staff_write" on public.rental_settings;
create policy "rental_settings_staff_write" on public.rental_settings
  for all using (public.is_staff()) with check (public.is_staff());

-- ============================================
-- Función: is_unit_available — ¿la unidad está libre en [p_from, p_to]?
-- Bloquean: confirmed + picked_up + pending_payment de los últimos ~20 min.
-- ============================================
create or replace function public.is_unit_available(
  p_unit_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.board_units u where u.id = p_unit_id and u.status = 'available')
    and not exists (
      select 1
      from public.rentals r
      where r.unit_id = p_unit_id
        and tstzrange(r.start_at, r.end_at) && tstzrange(p_from, p_to)
        and (
          r.status in ('confirmed', 'picked_up')
          or (r.status = 'pending_payment' and r.created_at > now() - interval '20 minutes')
        )
    );
$$;

revoke all on function public.is_unit_available(uuid, timestamptz, timestamptz) from public;
grant execute on function public.is_unit_available(uuid, timestamptz, timestamptz)
  to anon, authenticated, service_role;

-- ============================================
-- Función: list_available_units — catálogo filtrable para el widget online.
-- Devuelve las unidades activas (opcionalmente de una categoría) libres en el
-- rango, con specs y tarifas de su modelo.
-- ============================================
create or replace function public.list_available_units(
  p_from timestamptz,
  p_to timestamptz,
  p_category text default null
)
returns table (
  unit_id uuid,
  code text,
  nickname text,
  photo_url text,
  default_fins integer,
  model_id uuid,
  model_name text,
  slug text,
  category text,
  length_label text,
  volume_l numeric,
  skill_level text,
  description text,
  image_urls text[],
  price_per_hour numeric,
  price_per_day numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id, u.code, u.nickname, coalesce(u.photo_url, m.image_urls[1]), u.default_fins,
    m.id, m.name, m.slug, m.category, m.length_label, m.volume_l, m.skill_level,
    m.description, m.image_urls, m.price_per_hour, m.price_per_day
  from public.board_units u
  join public.board_models m on m.id = u.model_id
  where u.status = 'available'
    and m.active = true
    and (p_category is null or m.category = p_category)
    and public.is_unit_available(u.id, p_from, p_to)
  order by m.sort_order, m.name, u.code;
$$;

revoke all on function public.list_available_units(timestamptz, timestamptz, text) from public;
grant execute on function public.list_available_units(timestamptz, timestamptz, text)
  to anon, authenticated, service_role;

-- ============================================
-- Storage: bucket privado para las fotos de condición (salida/entrada).
-- Sólo el staff sube/lee. Ejecutar si el bucket no existe (o crearlo desde el
-- dashboard: Storage → New bucket → "rental-photos", Public = off).
-- ============================================
/*
insert into storage.buckets (id, name, public)
values ('rental-photos', 'rental-photos', false)
on conflict (id) do nothing;

drop policy if exists "rental_photos_staff_all" on storage.objects;
create policy "rental_photos_staff_all" on storage.objects
  for all using (bucket_id = 'rental-photos' and public.is_staff())
  with check (bucket_id = 'rental-photos' and public.is_staff());
*/

-- ============================================
-- Seed opcional — flota de ejemplo para desarrollo.
-- Reemplazar por datos reales antes de producción.
-- ============================================
/*
insert into public.board_models (name, slug, category, length_label, skill_level, price_per_hour, price_per_day, sort_order)
values
  ('Soft-top 7''0', 'softtop-7-0', 'softtop', '7''0', 'beginner', 8, 20, 1),
  ('Soft-top 8''0', 'softtop-8-0', 'softtop', '8''0', 'beginner', 8, 20, 2),
  ('Longboard 9''0', 'longboard-9-0', 'longboard', '9''0', 'all', 10, 25, 3),
  ('Funboard 7''6', 'funboard-7-6', 'funboard', '7''6', 'intermediate', 10, 25, 4)
on conflict (slug) do nothing;

insert into public.board_units (model_id, code, default_fins)
select m.id, m.slug || '-01', 3 from public.board_models m
on conflict (code) do nothing;
*/
