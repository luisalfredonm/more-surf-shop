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
-- Tabla: bookings (reserva de lección)
-- Flujo web (decisión #1 "reservar = pagar"):
--   pending_payment --(PayPal capturado)--> confirmed --> completed | no_show
--                    \--> cancelled
-- Walk-in del staff: se crea directo en 'confirmed' con payment 'cash'.
-- Disponibilidad cuenta: confirmed + pending_payment de los últimos ~20 min.
-- ============================================
create table if not exists public.bookings (
  id uuid primary key default uuid_generate_v4(),
  reference text not null unique,
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
  payment_id uuid references public.payments(id) on delete set null,
  waiver_id uuid references public.waivers(id) on delete set null,
  source text not null default 'web' check (source in ('web', 'walk_in', 'whatsapp', 'phone')),
  customer_note text,
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bookings_slot on public.bookings (slot_id);
create index if not exists idx_bookings_status_date on public.bookings (status, slot_date);
create index if not exists idx_bookings_customer on public.bookings (customer_id);
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
-- Función: get_available_slots — superficie de lectura de disponibilidad.
-- security definer: lee lesson_slots/bookings (RLS staff-only) pero solo expone
-- agregados no sensibles (horarios y cupo restante, sin datos personales).
-- La llama el server desde src/lib/queries/availability.ts
-- ============================================
create or replace function public.get_available_slots(
  p_from date,
  p_to date,
  p_class_type_id uuid default null,
  p_min_lead_hours integer default 2
)
returns table (
  slot_id uuid,
  slot_date date,
  start_time time,
  class_type_id uuid,
  class_type_name text,
  price_per_person numeric,
  ratio_label text,
  instructor_id uuid,
  instructor_name text,
  capacity_total integer,
  booked integer,
  remaining integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.slot_date,
    s.start_time,
    s.class_type_id,
    ct.name,
    ct.price_per_person,
    ct.ratio_label,
    s.instructor_id,
    i.name,
    s.capacity_total,
    coalesce(b.booked, 0)::integer,
    (s.capacity_total - coalesce(b.booked, 0))::integer
  from public.lesson_slots s
  join public.class_types ct on ct.id = s.class_type_id
  left join public.instructors i on i.id = s.instructor_id
  left join lateral (
    select sum(bk.participants_count)::integer as booked
    from public.bookings bk
    where bk.slot_id = s.id
      and (
        bk.status = 'confirmed'
        or (bk.status = 'pending_payment' and bk.created_at > now() - interval '20 minutes')
      )
  ) b on true
  where s.status = 'open'
    and s.slot_date between p_from and p_to
    and (p_class_type_id is null or s.class_type_id = p_class_type_id)
    and ((s.slot_date + s.start_time) at time zone 'America/Costa_Rica')
        > now() + (greatest(p_min_lead_hours, 0) * interval '1 hour')
    and s.capacity_total - coalesce(b.booked, 0) > 0
  order by s.slot_date, s.start_time, ct.name;
$$;

-- ============================================
-- Función: open_lesson_slots — abre slots en lote (staff / SQL editor).
-- Idempotente por lesson_slots_slot_unique. No accesible por anon.
-- Devuelve cuántos slots nuevos se crearon.
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
