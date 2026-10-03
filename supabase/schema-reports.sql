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
--   sales_transactions -> listado  -> lo mismo, un renglón por pago (imprimible)
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
-- Reembolsos de PayPal: un movimiento NUEVO, no un pago pisado.
--
-- Antes el reembolso hacía `update payments set status = 'refunded'` sobre la
-- venta original. Eso reescribía el pasado: la venta del 10/8 desaparecía del
-- 10/8 y el reembolso quedaba fechado el 10/8 en vez del día en que ocurrió.
-- Un reporte impreso dejaba de coincidir con el mismo día reimpreso después.
--
-- Ahora es igual que el reembolso de mostrador: la venta queda 'paid' y el
-- reembolso es otra fila 'refunded' con paid_at = cuándo se devolvió.
-- Ver src/lib/paypal-refund.ts.
-- ============================================

-- Datos viejos (sólo dev: prod arranca limpio). Se corrige en dos pasos:
--  1) filas nunca cobradas (checkouts abandonados, paid_at null) que el
--     webhook viejo marcó 'refunded' junto con la venta -> 'failed'.
update public.payments
   set status = 'failed'
 where provider = 'paypal'
   and status = 'refunded'
   and paid_at is null;

--  2) la venta pisada vuelve a 'paid' y se crea su reembolso, fechado cuando
--     se pisó (updated_at, que el trigger movió en ese update). Las filas de
--     reembolso llevan "kind":"refund" en notes, así que reejecutar no repite.
with legacy as (
  select id, amount, currency, related_type, related_id, updated_at
    from public.payments
   where provider = 'paypal'
     and status = 'refunded'
     and paid_at is not null
     and coalesce(notes, '') not like '%"kind":"refund"%'
),
restored as (
  update public.payments p
     set status = 'paid'
    from legacy l
   where p.id = l.id
)
insert into public.payments (
  provider, amount, currency, status, paid_at, related_type, related_id, notes
)
select 'paypal', l.amount, l.currency, 'refunded', l.updated_at,
       l.related_type, l.related_id, '{"kind":"refund","legacy":true}'
  from legacy l;

-- Un reembolso de PayPal por venta. El endpoint y el webhook pueden llegar a
-- la vez para el mismo reembolso: el segundo choca acá y se ignora.
create unique index if not exists uq_payments_paypal_refund
  on public.payments (related_type, related_id)
  where provider = 'paypal' and status = 'refunded';

-- ============================================
-- Función: payment_service — a qué servicio pertenece un pago.
--
-- Un booking_group agrupa reservas de UN SOLO tipo por checkout (ver
-- src/lib/group-lines.ts), así que se resuelve mirando si el grupo tiene
-- líneas en `rentals`. Si no, es de lecciones.
--
-- La usan sales_report y sales_transactions: si cada una clasificara por su
-- lado, la suma del listado podría no dar el total por servicio.
-- ============================================
create or replace function public.payment_service(p_related_type text, p_related_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case p_related_type
    when 'booking' then 'lessons'
    when 'rental_reservation' then 'rentals'
    when 'order' then 'shop'
    when 'booking_group' then
      case
        when exists (select 1 from public.rentals r where r.group_id = p_related_id)
        then 'rentals' else 'lessons'
      end
    else p_related_type
  end;
$$;

-- Helper interno: sólo lo llaman las funciones security definer de abajo.
revoke all on function public.payment_service(text, uuid) from public, anon, authenticated;

-- ============================================
-- Función: sales_report — ventas de un período, por servicio y método.
--
-- Una fila por (servicio × método de cobro). La app pivotea.
--
-- Fechas: p_from y p_to son días de CALENDARIO EN COSTA RICA (UTC-6 todo el
-- año), ambos inclusive. Un pago de las 19:00 del 8 en Costa Rica es 01:00 UTC
-- del 9; sin convertir, caería en el día equivocado.
--
-- Servicio: ver payment_service.
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
    public.payment_service(p.related_type, p.related_id) as service,
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

-- ============================================
-- Función: sales_transactions — el listado: un renglón por pago.
--
-- Mismo universo que sales_report (mismas fechas, mismos estados), así que la
-- suma de este listado da exactamente los totales de arriba. Es por PAGO y no
-- por artículo porque el pago es lo que cuadra contra el cajón y el banco; lo
-- que se vendió va en `items`, armado según a qué apunta el pago:
--
--   order              -> order_items (snapshots de nombre y cantidad)
--   booking            -> la lección
--   rental_reservation -> la tabla (o el cobro por daño, que viene en `note`)
--   booking_group      -> todas las líneas del checkout web
--
-- Orden cronológico: el reporte de un día se lee de la mañana a la noche.
-- ============================================
create or replace function public.sales_transactions(p_from date, p_to date)
returns table (
  payment_id uuid,
  paid_at timestamptz,
  status text,
  method text,
  amount numeric,
  fee numeric,
  net numeric,
  service text,
  reference text,
  customer text,
  items text[],
  collected_by text,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.paid_at,
    p.status,
    p.provider,
    p.amount,
    p.fee,
    case when p.status = 'paid'
      then coalesce(p.net_amount, p.amount - coalesce(p.fee, 0))
    end,
    public.payment_service(p.related_type, p.related_id),
    src.reference,
    src.customer,
    coalesce(lines.items, '{}'),
    pr.display_name,
    -- Las notas de PayPal son JSON técnico (capture_id…), no texto para el reporte.
    case when p.notes is null or ltrim(p.notes) like '{%' then null else p.notes end
  from public.payments p
  left join public.profiles pr on pr.id = p.collected_by
  left join lateral (
    select o.reference, c.full_name as customer
      from public.orders o
      left join public.customers c on c.id = o.customer_id
     where p.related_type = 'order' and o.id = p.related_id
    union all
    select b.reference, c.full_name
      from public.bookings b
      join public.customers c on c.id = b.customer_id
     where p.related_type = 'booking' and b.id = p.related_id
    union all
    select r.reference, c.full_name
      from public.rentals r
      join public.customers c on c.id = r.customer_id
     where p.related_type = 'rental_reservation' and r.id = p.related_id
    union all
    select g.reference, c.full_name
      from public.booking_groups g
      join public.customers c on c.id = g.customer_id
     where p.related_type = 'booking_group' and g.id = p.related_id
    limit 1
  ) src on true
  left join lateral (
    select array_agg(l.line order by l.sort_at, l.line) as items
    from (
      select oi.created_at as sort_at,
             oi.name_snapshot
               || case when oi.qty > 1 then ' ×' || oi.qty else '' end as line
        from public.order_items oi
       where p.related_type = 'order' and oi.order_id = p.related_id
      union all
      select b.created_at,
             ct.name
               || ' · ' || b.participants_count
               || case when b.participants_count = 1 then ' person' else ' people' end
               || ' · ' || to_char(b.slot_date + b.start_time, 'Mon FMDD, FMHH12:MI AM')
        from public.bookings b
        join public.class_types ct on ct.id = b.class_type_id
       where (p.related_type = 'booking' and b.id = p.related_id)
          or (p.related_type = 'booking_group' and b.group_id = p.related_id)
      union all
      select r.created_at,
             m.name || ' (' || u.code || ')'
               || ' · ' || r.units_billed || ' ' || r.rate_type
               || case when r.units_billed = 1 then '' else 's' end
        from public.rentals r
        join public.board_models m on m.id = r.model_id
        join public.board_units u on u.id = r.unit_id
       where (p.related_type = 'rental_reservation' and r.id = p.related_id)
          or (p.related_type = 'booking_group' and r.group_id = p.related_id)
    ) l
  ) lines on true
  where public.is_owner()
    and p.paid_at is not null
    and (p.paid_at at time zone 'America/Costa_Rica')::date between p_from and p_to
    and p.status in ('paid', 'refunded')
  order by p.paid_at, p.id;
$$;

revoke all on function public.sales_transactions(date, date) from public;
grant execute on function public.sales_transactions(date, date) to authenticated, service_role;
