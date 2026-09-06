-- ============================================
-- More Surf Shop — Schema SQL · Programación de horarios (plantilla semanal)
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql y schema-bookings.sql.
-- Idempotente.
--
-- Modelo: la disponibilidad NO se materializa. Se define una plantilla
-- semanal (weekly_slots) y excepciones por fecha (date_overrides).
-- get_available_slots() (en schema-bookings.sql) la calcula al vuelo.
--
-- Las tablas lesson_slots / la función open_lesson_slots quedan obsoletas
-- (se pueden dejar; ya no las usa nada).
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
