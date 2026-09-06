-- ============================================
-- More Surf Shop — Schema SQL · Fase 1: Reservas de lecciones + base compartida
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql.
-- Idempotente: puede reejecutarse sin duplicar.
--
-- Tablas base compartida (las usan también Fase 3 rentas y Fase 4 tienda):
--   profiles, customers, waivers, payments
-- Tablas de este módulo:
--   lesson_slots, bookings, booking_participants
--
-- Patrón de acceso: TODAS las escrituras públicas pasan por API routes del
-- server con service_role (que bypassa RLS). Las policies de abajo solo
-- habilitan al staff autenticado y protegen contra usos accidentales del
-- anon_key en el cliente. No hay acceso público directo a estas tablas.
-- ============================================

create extension if not exists "uuid-ossp";

-- Reutilizado por los triggers de updated_at (también definido en schema.sql;
-- se redeclara aquí para que este archivo pueda correr de forma independiente).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Límites de personas por tipo de clase (los usa el paso "Guests" del wizard).
-- min_guests: mínimo por reserva. max_guests: tope (null = usar la capacidad del slot).
alter table public.class_types add column if not exists min_guests integer not null default 1;
alter table public.class_types add column if not exists max_guests integer;
alter table public.class_types add column if not exists duration_min integer not null default 90;
-- max_capacity: cupo total de personas por horario (todas las reservas juntas).
alter table public.class_types add column if not exists max_capacity integer not null default 8;

-- ============================================
-- Tabla: profiles (staff + dueño, ligado a auth.users)
-- role: owner (todo) | staff (operación)
-- ============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('owner', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Helpers para RLS. security definer para poder leer profiles sin recursión de policy.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and role in ('owner', 'staff')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active = true and role = 'owner'
  );
$$;

-- ============================================
-- Tabla: customers (persona única — lecciones, rentas y tienda)
-- Sus campos salen del waiver en papel.
-- ============================================
create table if not exists public.customers (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  email text not null,
  phone text,
  id_type text check (id_type in ('cedula', 'dimex', 'passport', 'other')),
  id_number text,
  country_of_residence text,
  address text,
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice para el "find or create by email" que hace la API (no unique: una
-- persona puede tener más de un registro y se consolida en la app, no en la BD).
create index if not exists idx_customers_email on public.customers (lower(email));
create index if not exists idx_customers_created_at on public.customers (created_at desc);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: waivers (release of liability — versionado)
-- Guarda el texto exacto que se mostró + rastro de auditoría.
-- Un waiver puede cubrir una visita completa (lección + renta el mismo día).
-- ============================================
create table if not exists public.waivers (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  waiver_version text not null,
  activity text not null check (activity in ('lesson', 'rental', 'both')),
  signed_at timestamptz not null default now(),
  signer_name_typed text not null,
  accepted_terms boolean not null default false,
  is_minor boolean not null default false,
  guardian_name text,
  ip text,
  user_agent text,
  rendered_text_snapshot text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_waivers_customer on public.waivers (customer_id);
create index if not exists idx_waivers_signed_at on public.waivers (signed_at desc);

-- ============================================
-- Tabla: payments (abstracción única — la reutilizan Fase 3 y Fase 4)
-- provider: paypal (hoy) | sinpe | cash | tilopay (futuro)
-- related_type + related_id: FK "blanda" polimórfica (no se puede FK a varias tablas)
-- ============================================
create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  provider text not null check (provider in ('paypal', 'sinpe', 'cash', 'tilopay')),
  provider_ref text,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  paid_at timestamptz,
  related_type text not null check (related_type in ('booking', 'rental_reservation', 'order')),
  related_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_related on public.payments (related_type, related_id);
create index if not exists idx_payments_status on public.payments (status);
create index if not exists idx_payments_provider_ref on public.payments (provider_ref) where provider_ref is not null;

-- Ampliar related_type para pagos a nivel de grupo (un checkout con varias reservas).
alter table public.payments drop constraint if exists payments_related_type_check;
alter table public.payments add constraint payments_related_type_check
  check (related_type in ('booking', 'booking_group', 'rental_reservation', 'order'));

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: lesson_slots (disponibilidad — la define el staff según marea)
-- Un slot = fecha + hora + tipo de clase + instructor + capacidad.
-- La capacidad usada NO se guarda: se calcula sumando participants_count de
-- las reservas activas del slot (evita drift). Ver src/lib/queries/availability.ts
-- ============================================
create table if not exists public.lesson_slots (
  id uuid primary key default uuid_generate_v4(),
  slot_date date not null,
  start_time time not null,
  class_type_id uuid not null references public.class_types(id) on delete restrict,
  instructor_id uuid references public.instructors(id) on delete set null,
  capacity_total integer not null check (capacity_total >= 1),
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT: un slot sin instructor asignado (instructor_id null)
  -- también colisiona en el upsert. Requiere PostgreSQL 15+ (Supabase lo es).
  constraint lesson_slots_slot_unique
    unique nulls not distinct (slot_date, start_time, class_type_id, instructor_id)
);

create index if not exists idx_lesson_slots_date on public.lesson_slots (slot_date, status);

drop trigger if exists trg_lesson_slots_updated_at on public.lesson_slots;
create trigger trg_lesson_slots_updated_at
  before update on public.lesson_slots
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: booking_groups (un checkout = 1..N reservas confirmadas/pagadas juntas)
-- El cliente ve el código del grupo (GRP-XXXXX); el staff ve cada booking.
-- ============================================
create table if not exists public.booking_groups (
  id uuid primary key default uuid_generate_v4(),
  reference text not null unique,          -- GRP-XXXXX
  customer_id uuid not null references public.customers(id) on delete restrict,
  total_amount numeric(10, 2) not null default 0,
  currency text not null default 'USD' check (char_length(currency) = 3),
  payment_method text check (payment_method in ('paypal', 'on_arrival')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_booking_groups_customer on public.booking_groups (customer_id);
alter table public.booking_groups add column if not exists reminder_sent_at timestamptz;

-- ============================================
-- Tabla: bookings (una reserva de lección; pertenece a un booking_group)
-- Flujo web:
--   payment_method = 'paypal'     -> pending_payment --(capturado)--> confirmed
--   payment_method = 'on_arrival' -> confirmed de una (paga en la tienda)
--                                    --> completed | no_show | cancelled
-- Walk-in del staff: 'confirmed' directo. El waiver se firma en la tienda.
-- Disponibilidad cuenta: confirmed + pending_payment de los últimos ~20 min.
-- ============================================
create table if not exists public.bookings (
  id uuid primary key default uuid_generate_v4(),
  reference text not null unique,
  group_id uuid references public.booking_groups(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  class_type_id uuid not null references public.class_types(id) on delete restrict,
  slot_id uuid references public.lesson_slots(id) on delete set null,
  -- snapshot denormalizado para el historial aunque el slot se borre/edite
  slot_date date not null,
  start_time time not null,
  participants_count integer not null check (participants_count >= 1 and participants_count <= 20),
  unit_price numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null default 0,
  currency text not null default 'USD' check (char_length(currency) = 3),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show')),
  payment_method text check (payment_method in ('paypal', 'on_arrival')),
  payment_id uuid references public.payments(id) on delete set null,
  waiver_id uuid references public.waivers(id) on delete set null,
  source text not null default 'web' check (source in ('web', 'walk_in', 'whatsapp', 'phone')),
  customer_note text,
  staff_note text,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Para bases creadas con una versión previa de este archivo.
alter table public.bookings add column if not exists confirmation_sent_at timestamptz;
alter table public.bookings add column if not exists group_id uuid references public.booking_groups(id) on delete set null;
alter table public.bookings add column if not exists payment_method text;
do $$ begin
  alter table public.bookings add constraint bookings_payment_method_check
    check (payment_method in ('paypal', 'on_arrival'));
exception when duplicate_object then null; end $$;

create index if not exists idx_bookings_slot on public.bookings (slot_id);
create index if not exists idx_bookings_status_date on public.bookings (status, slot_date);
create index if not exists idx_bookings_customer on public.bookings (customer_id);
create index if not exists idx_bookings_group on public.bookings (group_id);
create index if not exists idx_bookings_pending_created on public.bookings (created_at)
  where status = 'pending_payment';

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: booking_participants
-- El titular es un customer; los acompañantes son registros livianos.
-- El waiver es por persona: cada adulto puede tener su waiver_id.
-- ============================================
create table if not exists public.booking_participants (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  full_name text not null,
  age integer check (age >= 0 and age <= 120),
  is_minor boolean not null default false,
  weight_kg numeric(5, 1),
  height_cm numeric(5, 1),
  experience_level text
    check (experience_level in ('first_time', 'beginner', 'intermediate', 'advanced')),
  waiver_id uuid references public.waivers(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_participants_booking on public.booking_participants (booking_id);

-- ============================================
-- Row-Level Security
-- Todo staff-only. Las interacciones públicas (crear reserva, consultar
-- disponibilidad) pasan por API routes con service_role, que bypassa RLS.
-- ============================================
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.waivers enable row level security;
alter table public.payments enable row level security;
alter table public.lesson_slots enable row level security;
alter table public.booking_groups enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_participants enable row level security;

-- profiles: cada quien lee el suyo; el staff lee todos; solo el owner escribe.
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_staff_read" on public.profiles;
create policy "profiles_staff_read" on public.profiles
  for select using (public.is_staff());

drop policy if exists "profiles_owner_write" on public.profiles;
create policy "profiles_owner_write" on public.profiles
  for all using (public.is_owner()) with check (public.is_owner());

-- customers / waivers / payments / bookings / booking_participants: staff full access.
drop policy if exists "customers_staff_all" on public.customers;
create policy "customers_staff_all" on public.customers
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "waivers_staff_all" on public.waivers;
create policy "waivers_staff_all" on public.waivers
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "payments_staff_all" on public.payments;
create policy "payments_staff_all" on public.payments
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "booking_groups_staff_all" on public.booking_groups;
create policy "booking_groups_staff_all" on public.booking_groups
  for all using (public.is_staff()) with check (public.is_staff());

-- class_types / instructors: lectura pública ya existe (schema.sql).
-- El staff además puede leer inactivos y editar (panel Prices & Services).
drop policy if exists "class_types_staff_all" on public.class_types;
create policy "class_types_staff_all" on public.class_types
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "instructors_staff_all" on public.instructors;
create policy "instructors_staff_all" on public.instructors
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "bookings_staff_all" on public.bookings;
create policy "bookings_staff_all" on public.bookings
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "booking_participants_staff_all" on public.booking_participants;
create policy "booking_participants_staff_all" on public.booking_participants
  for all using (public.is_staff()) with check (public.is_staff());

-- lesson_slots: lectura y escritura solo staff. La disponibilidad pública se
-- sirve desde el server (query dedicada), no por acceso directo del browser.
drop policy if exists "lesson_slots_staff_all" on public.lesson_slots;
create policy "lesson_slots_staff_all" on public.lesson_slots
  for all using (public.is_staff()) with check (public.is_staff());

-- ============================================
-- Función: get_available_slots — vive en schema-scheduling.sql
-- (depende de weekly_slots / date_overrides, que se crean allí).
-- ============================================

-- ============================================
-- Función: open_lesson_slots — OBSOLETA (se pasó al modelo de plantilla
-- semanal en schema-scheduling.sql). Se deja por compatibilidad; nada la usa.
-- ============================================
create or replace function public.open_lesson_slots(
  p_dates date[],
  p_times time[],
  p_class_type_id uuid,
  p_instructor_id uuid default null,
  p_capacity integer default 4
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_time time;
  v_count integer := 0;
begin
  -- Si hay usuario autenticado, debe ser staff. Contexto server/SQL (sin uid) pasa.
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'not authorized: staff only';
  end if;

  foreach v_date in array p_dates loop
    foreach v_time in array p_times loop
      insert into public.lesson_slots
        (slot_date, start_time, class_type_id, instructor_id, capacity_total)
      values
        (v_date, v_time, p_class_type_id, p_instructor_id, greatest(p_capacity, 1))
      on conflict on constraint lesson_slots_slot_unique do nothing;
      if found then
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.open_lesson_slots(date[], time[], uuid, uuid, integer) from public;
grant execute on function public.open_lesson_slots(date[], time[], uuid, uuid, integer)
  to authenticated, service_role;

-- ============================================
-- Seed opcional — abrir slots de prueba tras cargar class_types e instructors.
-- ============================================
-- Opción A: la función en lote (una clase, varios días y horas).
--   select public.open_lesson_slots(
--     array[current_date + 1, current_date + 2]::date[],
--     array['07:00', '09:30']::time[],
--     (select id from public.class_types where name ilike '%group%' limit 1),
--     null,        -- instructor (opcional)
--     4            -- capacidad
--   );
--
-- Opción B: insert directo para todas las clases activas, mañana.
/*
insert into public.lesson_slots (slot_date, start_time, class_type_id, instructor_id, capacity_total)
select
  (current_date + 1),
  t.start_time,
  ct.id,
  null,
  case when ct.name ilike '%group%' then 4 else 3 end
from public.class_types ct
cross join (values ('07:00'::time), ('09:30'::time)) as t(start_time)
where ct.active = true and ct.category = 'lesson'
on conflict on constraint lesson_slots_slot_unique do nothing;
*/
