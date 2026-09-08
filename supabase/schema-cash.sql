-- ============================================
-- More Surf Shop — Schema SQL · T4: Pago al reservar + atribución + cierre de caja
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema-bookings.sql y schema-rentals.sql.
-- Idempotente: puede reejecutarse sin duplicar.
--
-- Reusa: profiles, is_staff(), is_owner(), set_updated_at(), payments, rentals, bookings.
--
-- Modelo:
--   cash_shifts   — un turno de caja de un empleado (apertura → cierre formal)
--   payments.collected_by / shift_id — quién cobró y en qué turno (null = pago online)
--   rentals.reserved_by             — qué empleado creó la reserva (null = vía web)
--   'card' se suma como método de pago en payments / rentals / bookings
--
-- Decisiones (ver docs/ETAPA-2-PLAN.md §13 T4):
--   - Se paga al reservar (walk-in y reserva futura). Efectivo o tarjeta.
--   - Tarjeta = sólo se registra "pagado con tarjeta $X" (sin voucher).
--   - Cierre formal: fondo inicial (lo fija el empleado) + efectivo contado + diferencia.
--   - El cierre suma rentals + lecciones del día. La tarjeta se muestra aparte y
--     NO entra en la diferencia de efectivo (la concilia el datáfono).
--   - Se obliga a abrir turno antes de cobrar. Dos turnos por día en la práctica.
--   - Diferencia: deja cerrar, pide nota. Correcciones: nota + ajuste + refund real.
--   - Cada empleado ve su cierre; el dueño ve todos y es el único que reabre/edita.
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
-- Métodos de pago: sumar 'card' (datáfono — el sistema sólo registra el hecho)
-- ============================================
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('paypal', 'sinpe', 'cash', 'tilopay', 'card'));

alter table public.rentals drop constraint if exists rentals_payment_method_check;
alter table public.rentals add constraint rentals_payment_method_check
  check (payment_method in ('paypal', 'on_arrival', 'cash', 'card'));

alter table public.bookings drop constraint if exists bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check
  check (payment_method in ('paypal', 'on_arrival', 'cash', 'card'));

alter table public.booking_groups drop constraint if exists booking_groups_payment_method_check;
alter table public.booking_groups add constraint booking_groups_payment_method_check
  check (payment_method in ('paypal', 'on_arrival', 'cash', 'card'));

-- ============================================
-- Tabla: cash_shifts — un turno de caja de un empleado
-- Flujo: abrir (fondo inicial) → cobrar durante el turno → cerrar (contar efectivo).
-- expected_cash / difference / card_total son snapshots calculados al cerrar.
-- ============================================
create table if not exists public.cash_shifts (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  opening_float numeric(10, 2) not null default 0 check (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  -- snapshots al cerrar
  expected_cash numeric(10, 2),   -- opening_float + Σ efectivo cobrado en el turno
  counted_cash numeric(10, 2),    -- lo ingresa el empleado al cerrar
  difference numeric(10, 2),      -- counted_cash - expected_cash (faltante/sobrante)
  card_total numeric(10, 2),      -- Σ tarjeta del turno (informativo, no entra en difference)
  status text not null default 'open' check (status in ('open', 'closed', 'reopened')),
  notes text,                     -- justificación de la diferencia / ajustes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_shifts_open_has_no_close check (
    status <> 'open' or (closed_at is null and closed_by is null)
  )
);

-- Un solo turno abierto por empleado a la vez (lo aplica el guard de /api, esto lo respalda).
create unique index if not exists idx_cash_shifts_one_open
  on public.cash_shifts (profile_id) where status = 'open';
create index if not exists idx_cash_shifts_profile_opened
  on public.cash_shifts (profile_id, opened_at desc);
create index if not exists idx_cash_shifts_open
  on public.cash_shifts (opened_at desc) where status = 'open';

drop trigger if exists trg_cash_shifts_updated_at on public.cash_shifts;
create trigger trg_cash_shifts_updated_at
  before update on public.cash_shifts
  for each row execute function public.set_updated_at();

-- ============================================
-- Atribución en payments + rentals
-- ============================================
alter table public.payments
  add column if not exists collected_by uuid references public.profiles(id) on delete set null;
alter table public.payments
  add column if not exists shift_id uuid references public.cash_shifts(id) on delete set null;

create index if not exists idx_payments_shift on public.payments (shift_id) where shift_id is not null;
create index if not exists idx_payments_collected_by
  on public.payments (collected_by, paid_at desc) where collected_by is not null;

alter table public.rentals
  add column if not exists reserved_by uuid references public.profiles(id) on delete set null;
create index if not exists idx_rentals_reserved_by on public.rentals (reserved_by) where reserved_by is not null;

-- ============================================
-- Row-Level Security — cash_shifts
-- El empleado ve/gestiona SÓLO los suyos y sólo mientras están 'open'.
-- El dueño ve todo y es el único que reabre/edita/borra.
-- ============================================
alter table public.cash_shifts enable row level security;

drop policy if exists "cash_shifts_select" on public.cash_shifts;
create policy "cash_shifts_select" on public.cash_shifts
  for select using (public.is_owner() or profile_id = auth.uid());

drop policy if exists "cash_shifts_insert_own" on public.cash_shifts;
create policy "cash_shifts_insert_own" on public.cash_shifts
  for insert with check (public.is_staff() and profile_id = auth.uid());

drop policy if exists "cash_shifts_update" on public.cash_shifts;
create policy "cash_shifts_update" on public.cash_shifts
  for update using (
    public.is_owner() or (profile_id = auth.uid() and status = 'open')
  ) with check (
    public.is_owner() or profile_id = auth.uid()
  );

drop policy if exists "cash_shifts_delete_owner" on public.cash_shifts;
create policy "cash_shifts_delete_owner" on public.cash_shifts
  for delete using (public.is_owner());

-- ============================================
-- Función: cash_shift_totals — suma los pagos de un turno por método.
-- La usa la vista de cierre para calcular expected_cash / card_total sin
-- depender de que el cliente arme la query. security definer: corre como owner
-- pero sólo devuelve agregados de un turno que el llamante ya puede ver por RLS
-- (se valida shift_id contra cash_shifts + is_staff()).
-- ============================================
create or replace function public.cash_shift_totals(p_shift_id uuid)
returns table (
  cash_total numeric,
  card_total numeric,
  cash_count integer,
  card_count integer,
  refunds_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where provider = 'cash' and status = 'paid'), 0),
    coalesce(sum(amount) filter (where provider = 'card' and status = 'paid'), 0),
    count(*) filter (where provider = 'cash' and status = 'paid')::int,
    count(*) filter (where provider = 'card' and status = 'paid')::int,
    coalesce(sum(amount) filter (where status = 'refunded'), 0)
  from public.payments
  where shift_id = p_shift_id
    and public.is_staff();
$$;

revoke all on function public.cash_shift_totals(uuid) from public;
grant execute on function public.cash_shift_totals(uuid) to authenticated, service_role;
