-- ============================================
-- More Surf Shop — Schema SQL · Configuración del proveedor de pago online
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema-bookings.sql.
-- Idempotente.
--
-- Fila única. La edita el DUEÑO en el panel (Settings → Pagos). Contiene el
-- secret de PayPal, así que RLS = owner-only; el server la lee con service_role.
-- Si la fila está vacía, la app cae a las env vars PAYPAL_* (ver src/lib/paypal.ts).
-- ============================================

create extension if not exists "uuid-ossp";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.payment_settings (
  id smallint primary key default 1 check (id = 1),
  paypal_enabled boolean not null default false,
  paypal_env text not null default 'sandbox' check (paypal_env in ('sandbox', 'live')),
  paypal_client_id text,
  paypal_secret text,
  paypal_webhook_id text,
  updated_at timestamptz not null default now()
);

insert into public.payment_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_payment_settings_updated_at on public.payment_settings;
create trigger trg_payment_settings_updated_at
  before update on public.payment_settings
  for each row execute function public.set_updated_at();

-- ============================================
-- RLS — sólo el dueño (contiene el secret). El server usa service_role (saltea RLS).
-- ============================================
alter table public.payment_settings enable row level security;

drop policy if exists "payment_settings_owner" on public.payment_settings;
create policy "payment_settings_owner" on public.payment_settings
  for all using (public.is_owner()) with check (public.is_owner());
