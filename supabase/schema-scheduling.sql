-- ============================================
-- More Surf Shop — Schema SQL · Programación de horarios (plantilla semanal)
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql y schema-bookings.sql.
-- Idempotente.
--
-- Modelo: la disponibilidad NO se materializa. Se define una plantilla
-- semanal (weekly_slots) + excepciones por fecha (date_overrides), y la
-- función get_available_slots() (al final de este archivo) la calcula al vuelo.
--
-- Requiere que schema-bookings.sql ya haya corrido (usa is_staff(), bookings).
-- Las tablas lesson_slots / open_lesson_slots quedan obsoletas (nada las usa).
-- ============================================

create extension if not exists "uuid-ossp";

-- ============================================
-- Tabla: weekly_slots (plantilla recurrente: servicio × día de semana × hora)
-- weekday: 0 = domingo … 6 = sábado  (compatible con extract(dow from date))
-- ============================================
create table if not exists public.weekly_slots (
  id uuid primary key default uuid_generate_v4(),
  class_type_id uuid not null references public.class_types(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (class_type_id, weekday, start_time)
);
create index if not exists idx_weekly_slots_lookup
  on public.weekly_slots (class_type_id, weekday) where active;

-- ============================================
-- Tabla: date_overrides (excepción para una fecha puntual)
--   kind = 'closed'  -> ese día no hay horarios (para el servicio, o para todos)
--   kind = 'custom'  -> ese día se usan `times` en vez de la plantilla
-- class_type_id null  -> aplica a TODOS los servicios ese día
-- El override específico de un servicio gana sobre el global.
-- ============================================
create table if not exists public.date_overrides (
  id uuid primary key default uuid_generate_v4(),
  class_type_id uuid references public.class_types(id) on delete cascade,
  override_date date not null,
  kind text not null check (kind in ('closed', 'custom')),
  times time[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  unique (class_type_id, override_date)
);
create index if not exists idx_date_overrides_date on public.date_overrides (override_date);

-- ============================================
-- RLS — staff-only. La disponibilidad pública se sirve por get_available_slots
-- (security definer), no por acceso directo.
-- ============================================
alter table public.weekly_slots enable row level security;
alter table public.date_overrides enable row level security;

drop policy if exists "weekly_slots_staff_all" on public.weekly_slots;
create policy "weekly_slots_staff_all" on public.weekly_slots
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "date_overrides_staff_all" on public.date_overrides;
create policy "date_overrides_staff_all" on public.date_overrides
  for all using (public.is_staff()) with check (public.is_staff());

-- ============================================
-- Función: get_available_slots — disponibilidad calculada al vuelo.
--
-- Para cada (día del rango, servicio activo):
--   - si hay date_override 'closed'  -> sin horarios
--   - si hay date_override 'custom'  -> usa override.times
--   - si no                          -> usa weekly_slots de ese día de semana
-- Luego resta las reservas activas y aplica class_types.max_capacity, la
-- antelación mínima (zona horaria CR) y devuelve solo lo que tiene cupo.
-- El override específico de un servicio gana sobre el global (class_type_id null).
-- security definer: lee tablas con RLS staff-only pero solo expone agregados.
-- La llama el server desde src/lib/queries/availability.ts
-- ============================================
drop function if exists public.get_available_slots(date, date, uuid, integer);

create or replace function public.get_available_slots(
  p_from date,
  p_to date,
  p_class_type_id uuid default null,
  p_min_lead_hours integer default 2
)
returns table (
  slot_key text,
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
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  svc as (
    select id, name, price_per_person, ratio_label, max_capacity
    from public.class_types
    where active and (p_class_type_id is null or id = p_class_type_id)
  ),
  grid as (
    select days.day, svc.id as ct_id, svc.name, svc.price_per_person,
           svc.ratio_label, svc.max_capacity, ov.kind as ov_kind, ov.times as ov_times
    from days
    cross join svc
    left join lateral (
      select o.kind, o.times
      from public.date_overrides o
      where o.override_date = days.day
        and (o.class_type_id = svc.id or o.class_type_id is null)
      order by (o.class_type_id is not null) desc
      limit 1
    ) ov on true
  ),
  slots as (
    select g.day, g.ct_id, g.name, g.price_per_person, g.ratio_label, g.max_capacity, t.st
    from grid g
    cross join lateral (
      select ws.start_time as st
        from public.weekly_slots ws
        where ws.active and ws.class_type_id = g.ct_id
          and ws.weekday = extract(dow from g.day)::int
          and g.ov_kind is distinct from 'closed'
          and g.ov_kind is distinct from 'custom'
      union
      select unnest(g.ov_times) where g.ov_kind = 'custom'
    ) t(st)
  )
  select
    s.ct_id::text || '|' || s.day::text || '|' || s.st::text,
    s.day,
    s.st,
    s.ct_id,
    s.name,
    s.price_per_person,
    s.ratio_label,
    null::uuid,
    null::text,
    s.max_capacity,
    coalesce(bk.booked, 0)::integer,
    (s.max_capacity - coalesce(bk.booked, 0))::integer
  from slots s
  left join lateral (
    select sum(b.participants_count)::integer as booked
    from public.bookings b
    where b.class_type_id = s.ct_id
      and b.slot_date = s.day
      and b.start_time = s.st
      and (
        b.status = 'confirmed'
        or (b.status = 'pending_payment' and b.created_at > now() - interval '20 minutes')
      )
  ) bk on true
  where ((s.day + s.st) at time zone 'America/Costa_Rica')
        > now() + (greatest(p_min_lead_hours, 0) * interval '1 hour')
    and s.max_capacity - coalesce(bk.booked, 0) > 0
  order by s.day, s.st, s.name;
$$;
