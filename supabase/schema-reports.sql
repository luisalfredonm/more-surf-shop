-- ============================================
-- More Surf Shop — Schema SQL · Reporte de ventas + comisiones de pasarela
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema-cash.sql y schema-shop.sql.
-- Idempotente: puede reejecutarse sin duplicar.
--
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- El cierre de caja (cash_shift_totals) responde "¿cuánto efectivo debería
-- haber en el cajón?". Filtra por shift_id, así que sólo ve lo que se cobró en
-- el mostrador. La plata de PayPal nunca pasa por el cajón y por eso NO lleva
-- shift_id: meterla ahí haría que todos los arqueos den cortos y el control se
-- volvería ruido.
--
-- Pero "¿cuánto vendí?" es otra pregunta: se responde por FECHA DE PAGO, sin
-- turno, e incluye todo. Eso es lo que agregan las funciones de acá.
--
--   cash_shift_totals  -> arqueo   -> filtra por shift_id -> mostrador
--   sales_report       -> ventas   -> filtra por paid_at  -> todo, PayPal incluido
--
-- Las dos leen la MISMA tabla `payments`. No se duplica el dato en ningún lado.
-- ============================================

-- ============================================
-- Comisión de pasarela
--
-- PayPal deposita NETO: cobra su comisión antes de mandarte la plata. Hasta
-- ahora sólo guardábamos el bruto, así que el extracto bancario nunca podía
-- cuadrar contra las ventas y la diferencia no quedaba registrada.
--
-- fee        — lo que se quedó la pasarela (null en efectivo/tarjeta: no aplica)
-- net_amount — lo que realmente se deposita. Viene de PayPal, no se calcula.
--
-- Se guardan tal como los reporta la pasarela en `seller_receivable_breakdown`.
-- No los estimamos: la comisión de PayPal varía por país, moneda y tipo de
-- cuenta, y una estimación que casi cuadra es peor que un dato ausente.
-- ============================================
alter table public.payments add column if not exists fee numeric(10, 2)
  check (fee >= 0);
alter table public.payments add column if not exists net_amount numeric(10, 2)
  check (net_amount >= 0);

comment on column public.payments.fee is
  'Comisión de la pasarela. Null = no aplica (efectivo/tarjeta de mostrador) o el proveedor no la reportó.';
comment on column public.payments.net_amount is
  'Monto realmente depositado (bruto − comisión), tal como lo reporta la pasarela.';

-- Los cobros de mostrador no tienen comisión: neto = bruto. Se rellena una vez
-- para que el reporte no tenga que hacer coalesce por todos lados.
update public.payments
   set net_amount = amount
 where net_amount is null
   and provider in ('cash', 'card');

-- El reporte barre por fecha de pago; sin este índice hace seq scan.
create index if not exists idx_payments_paid_at
  on public.payments (paid_at) where paid_at is not null;

-- ============================================
-- Función: sales_report — ventas de un período, por servicio y método.
--
-- Una fila por (servicio × método de cobro). La app pivotea.
--
-- Fechas: p_from y p_to son días de CALENDARIO EN COSTA RICA (UTC-6 todo el
-- año), ambos inclusive. Un pago de las 19:00 del 8 en Costa Rica es 01:00 UTC
-- del 9; sin convertir, caería en el día equivocado.
--
-- Servicio: un booking_group agrupa reservas de UN SOLO tipo por checkout (ver
-- src/lib/group-lines.ts), así que se resuelve mirando si el grupo tiene
-- líneas en `rentals`. Si no, es de lecciones.
--
-- gross   — cobrado (status 'paid')
-- fee     — comisión de pasarela sobre eso
-- net     — lo que queda. Para efectivo/tarjeta es igual al bruto.
-- refunds — devuelto (status 'refunded'). NO se resta del bruto: se muestra
--           aparte para que se vea que existió, igual que en el arqueo.
-- ============================================
create or replace function public.sales_report(p_from date, p_to date)
returns table (
  service text,
  method text,
  gross numeric,
  fee numeric,
  net numeric,
  refunds numeric,
  txn_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case p.related_type
      when 'booking' then 'lessons'
      when 'rental_reservation' then 'rentals'
      when 'order' then 'shop'
      when 'booking_group' then
        case
          when exists (select 1 from public.rentals r where r.group_id = p.related_id)
          then 'rentals' else 'lessons'
        end
      else p.related_type
    end as service,
    p.provider as method,
    coalesce(sum(p.amount) filter (where p.status = 'paid'), 0) as gross,
    coalesce(sum(p.fee) filter (where p.status = 'paid'), 0) as fee,
    coalesce(
      sum(coalesce(p.net_amount, p.amount - coalesce(p.fee, 0)))
        filter (where p.status = 'paid'),
      0
    ) as net,
    coalesce(sum(p.amount) filter (where p.status = 'refunded'), 0) as refunds,
    count(*) filter (where p.status = 'paid')::int as txn_count
  from public.payments p
  where public.is_owner()
    and p.paid_at is not null
    and (p.paid_at at time zone 'America/Costa_Rica')::date between p_from and p_to
    and p.status in ('paid', 'refunded')
  group by 1, 2
  having coalesce(sum(p.amount) filter (where p.status in ('paid', 'refunded')), 0) > 0
  order by 1, 2;
$$;

revoke all on function public.sales_report(date, date) from public;
grant execute on function public.sales_report(date, date) to authenticated, service_role;

-- ============================================
-- Función: sales_daily — la misma plata, día por día.
-- Para la tira de barras del reporte. Devuelve sólo los días con movimiento;
-- los huecos los rellena la app (sabe el rango que pidió).
-- ============================================
create or replace function public.sales_daily(p_from date, p_to date)
returns table (
  day date,
  gross numeric,
  net numeric,
  txn_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (p.paid_at at time zone 'America/Costa_Rica')::date as day,
    coalesce(sum(p.amount), 0) as gross,
    coalesce(sum(coalesce(p.net_amount, p.amount - coalesce(p.fee, 0))), 0) as net,
    count(*)::int as txn_count
  from public.payments p
  where public.is_owner()
    and p.paid_at is not null
    and (p.paid_at at time zone 'America/Costa_Rica')::date between p_from and p_to
    and p.status = 'paid'
  group by 1
  order by 1;
$$;

revoke all on function public.sales_daily(date, date) from public;
grant execute on function public.sales_daily(date, date) to authenticated, service_role;

-- ============================================
-- Función: sales_unreconciled — cobros de mostrador que no cayeron en un turno.
--
-- Efectivo o tarjeta con shift_id null: plata que pasó por el cajón pero que
-- ningún arqueo va a ver. Es la fuga que hay que revisar, no un total a mostrar.
-- PayPal NO aparece acá: que no tenga turno es lo correcto.
-- ============================================
create or replace function public.sales_unreconciled(p_from date, p_to date)
returns table (
  payment_id uuid,
  provider text,
  amount numeric,
  related_type text,
  paid_at timestamptz,
  notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.provider, p.amount, p.related_type, p.paid_at, p.notes
  from public.payments p
  where public.is_owner()
    and p.provider in ('cash', 'card')
    and p.shift_id is null
    and p.status = 'paid'
    and p.paid_at is not null
    and (p.paid_at at time zone 'America/Costa_Rica')::date between p_from and p_to
  order by p.paid_at desc;
$$;

revoke all on function public.sales_unreconciled(date, date) from public;
grant execute on function public.sales_unreconciled(date, date) to authenticated, service_role;
