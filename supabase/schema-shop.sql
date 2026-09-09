-- ============================================
-- More Surf Shop — Schema SQL · Etapa 3: Tienda de accesorios (POS + escaparate)
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema-bookings.sql y schema-cash.sql.
-- Idempotente: puede reejecutarse sin duplicar.
--
-- Reusa: customers, payments, profiles, cash_shifts, is_staff(), is_owner(),
--        set_updated_at(). `payments.related_type` YA acepta 'order'.
--
-- Modelo:
--   products         — el producto de catálogo (nombre, precio, fotos)
--   product_variants — talla / color. TODO producto tiene al menos una ('Único')
--   inventory        — stock físico por variante (una sola bodega: la tienda)
--   inventory_moves  — kardex. ES LA ÚNICA VÍA para mover stock (ver §trigger)
--   orders           — una venta (mostrador u online)
--   order_items      — las líneas, con snapshot de nombre/sku/precio
--
-- Decisiones (ver docs/ETAPA-3-SHOP.md §3):
--   - Sin facturación electrónica. El POS emite un recibo impreso, NO fiscal.
--   - Precios con IVA incluido; el sistema no calcula desglose de impuesto.
--   - Online = "retirá en tienda". Sin envíos.
--   - El cobro inserta `payments` con collected_by + shift_id: entra al cierre
--     de caja SIN tocar el módulo de caja (cash_shift_totals filtra por shift_id).
--   - Una orden puede tener N pagos (split efectivo + tarjeta). Por eso `orders`
--     NO lleva payment_id: lo pagado = Σ payments where related_id = order.id.
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
-- Tabla: products — el producto de catálogo
-- El precio vive acá; la variante puede sobreescribirlo (price_override).
-- ============================================
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  category text not null
    check (category in ('leash', 'fins', 'wax', 'apparel', 'sunscreen', 'bags', 'accessories')),
  brand text,
  description text,
  image_urls text[] not null default '{}',
  price numeric(10, 2) not null default 0 check (price >= 0),  -- al público, IVA incluido
  cost numeric(10, 2),                     -- sin UI en v1 (decisión 7); para margen futuro
  has_variants boolean not null default false,
  active boolean not null default true,
  featured boolean not null default false, -- sale primero en la grilla del POS
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_active_sort
  on public.products (active, sort_order) where active = true;
create index if not exists idx_products_category on public.products (category);
create index if not exists idx_products_featured
  on public.products (featured, sort_order) where featured = true and active = true;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: product_variants — talla / color
--
-- REGLA CLAVE: el stock y las líneas de venta apuntan SIEMPRE a variant_id,
-- nunca a product_id. Un producto sin variantes reales tiene una variante
-- 'Único' que se crea sola (trigger de abajo). Así no hay dos caminos.
--
-- No hay código de barras (decisión 4): el `sku` es interno.
-- ============================================
create table if not exists public.product_variants (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,                -- interno, generado
  label text not null default 'Único',     -- 'M', 'L / Negro', 'Único'
  price_override numeric(10, 2) check (price_override >= 0),  -- null = usa products.price
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_label_per_product unique (product_id, label)
);

create index if not exists idx_product_variants_product
  on public.product_variants (product_id, sort_order);

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: inventory — stock físico. Una fila por variante, una sola bodega.
--
-- qty_on_hand = lo que está FÍSICAMENTE en la tienda. Baja cuando el producto
-- sale (orden -> 'picked_up'), no antes. Lo disponible para vender se CALCULA
-- (ver shop_variant_available): así los dos números no pueden desincronizarse.
--
-- No hay check qty_on_hand >= 0 a propósito: si el stock queda negativo es señal
-- de que falta un ajuste, y bloquear una venta en el mostrador es peor que
-- registrarla. La vista de Inventory lo marca en rojo.
-- ============================================
create table if not exists public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  qty_on_hand integer not null default 0,
  reorder_point integer check (reorder_point >= 0),  -- avisa "quedan pocas"
  updated_at timestamptz not null default now()
);

-- ============================================
-- Tabla: inventory_moves — kardex
--
-- ES LA ÚNICA VÍA PARA MOVER STOCK. Nadie hace `update inventory set qty_on_hand`:
-- se inserta un movimiento y el trigger lo aplica. Un solo camino de escritura =
-- el stock no puede quedar sin rastro.
-- ============================================
create table if not exists public.inventory_moves (
  id uuid primary key default uuid_generate_v4(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  delta integer not null check (delta <> 0),     -- + entrada / − salida
  reason text not null
    check (reason in ('sale', 'return', 'purchase', 'adjustment', 'shrinkage', 'correction')),
  related_type text check (related_type in ('order')),
  related_id uuid,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_moves_variant
  on public.inventory_moves (variant_id, created_at desc);
create index if not exists idx_inventory_moves_related
  on public.inventory_moves (related_type, related_id) where related_id is not null;

-- Aplica el movimiento al stock. Crea la fila de inventory si no existiera.
create or replace function public.apply_inventory_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory (variant_id, qty_on_hand, updated_at)
  values (new.variant_id, new.delta, now())
  on conflict (variant_id) do update
    set qty_on_hand = inventory.qty_on_hand + excluded.qty_on_hand,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_moves_apply on public.inventory_moves;
create trigger trg_inventory_moves_apply
  after insert on public.inventory_moves
  for each row execute function public.apply_inventory_move();

-- ============================================
-- Triggers de conveniencia: toda variante nace con su fila de stock, y todo
-- producto sin variantes nace con su variante 'Único'.
-- Evita left joins con coalesce por todos lados.
-- ============================================
create or replace function public.ensure_variant_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory (variant_id) values (new.id)
  on conflict (variant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_variant_inventory on public.product_variants;
create trigger trg_variant_inventory
  after insert on public.product_variants
  for each row execute function public.ensure_variant_inventory();

create or replace function public.ensure_default_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sólo para productos simples. Si has_variants = true, las carga el panel.
  if not new.has_variants then
    insert into public.product_variants (product_id, sku, label)
    values (new.id, new.slug, 'Único')
    on conflict (sku) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_default_variant on public.products;
create trigger trg_products_default_variant
  after insert on public.products
  for each row execute function public.ensure_default_variant();

-- ============================================
-- Tabla: orders — una venta
--
-- Estados y qué significan para el stock:
--   pending_payment — online esperando PayPal. Retiene stock 20 min.
--   reserved        — online "paga al retirar". Retiene stock 48 h.
--   paid            — pagada, esperando que el cliente pase. Retiene sin límite.
--   picked_up       — entregada. qty_on_hand YA se descontó. Terminal.
--   cancelled       — terminal, no retiene.
--
-- El POS crea la orden directamente en 'picked_up' (cobrar = entregar), así la
-- regla queda en una sola línea: el stock baja si y sólo si status = 'picked_up'.
-- ============================================
create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  reference text not null unique,                 -- 'ORD-XXXXX'
  channel text not null check (channel in ('pos', 'online')),
  customer_id uuid references public.customers(id) on delete set null,  -- null = venta anónima
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'reserved', 'paid', 'picked_up', 'cancelled')),
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(10, 2) not null default 0 check (discount_total >= 0),
  total numeric(10, 2) not null default 0 check (total >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  -- atribución (mismo criterio que rentals.reserved_by / checked_out_by)
  sold_by uuid references public.profiles(id) on delete set null,        -- mostrador (null = online)
  handed_over_by uuid references public.profiles(id) on delete set null, -- quién entregó
  shift_id uuid references public.cash_shifts(id) on delete set null,    -- turno del cobro
  picked_up_at timestamptz,
  customer_note text,
  staff_note text,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_picked_up_has_date check (
    status <> 'picked_up' or picked_up_at is not null
  )
);

create index if not exists idx_orders_status_created on public.orders (status, created_at desc);
create index if not exists idx_orders_channel_created on public.orders (channel, created_at desc);
create index if not exists idx_orders_shift on public.orders (shift_id) where shift_id is not null;
create index if not exists idx_orders_customer on public.orders (customer_id) where customer_id is not null;
-- La cola del mostrador: online pagadas/reservadas sin retirar.
create index if not exists idx_orders_pickup_queue on public.orders (created_at)
  where status in ('reserved', 'paid');
create index if not exists idx_orders_pending_created on public.orders (created_at)
  where status = 'pending_payment';

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ============================================
-- Tabla: order_items — las líneas
-- Snapshots de nombre/sku/precio: si mañana sube el precio del wax, el recibo
-- de ayer no cambia. Mismo criterio que rentals.unit_price.
-- ============================================
create table if not exists public.order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  name_snapshot text not null,                    -- 'Leash 6" Dakine — M'
  sku_snapshot text not null,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  qty integer not null check (qty > 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_variant on public.order_items (variant_id);

-- ============================================
-- Row-Level Security
-- products / product_variants: lectura pública de lo activo (catálogo).
-- inventory / inventory_moves / orders / order_items: staff-only. La
-- disponibilidad pública se sirve por las funciones security definer de abajo.
-- ============================================
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_moves enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "products_public_read" on public.products;
create policy "products_public_read" on public.products
  for select using (active = true);

drop policy if exists "products_staff_all" on public.products;
create policy "products_staff_all" on public.products
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "product_variants_public_read" on public.product_variants;
create policy "product_variants_public_read" on public.product_variants
  for select using (
    active = true
    and exists (select 1 from public.products p where p.id = product_id and p.active = true)
  );

drop policy if exists "product_variants_staff_all" on public.product_variants;
create policy "product_variants_staff_all" on public.product_variants
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "inventory_staff_all" on public.inventory;
create policy "inventory_staff_all" on public.inventory
  for all using (public.is_staff()) with check (public.is_staff());

-- El kardex no se edita ni se borra: sólo se agrega. Una corrección es otro
-- movimiento con reason 'correction', no un update.
drop policy if exists "inventory_moves_staff_read" on public.inventory_moves;
create policy "inventory_moves_staff_read" on public.inventory_moves
  for select using (public.is_staff());

drop policy if exists "inventory_moves_staff_insert" on public.inventory_moves;
create policy "inventory_moves_staff_insert" on public.inventory_moves
  for insert with check (public.is_staff());

drop policy if exists "inventory_moves_owner_delete" on public.inventory_moves;
create policy "inventory_moves_owner_delete" on public.inventory_moves
  for delete using (public.is_owner());

drop policy if exists "orders_staff_all" on public.orders;
create policy "orders_staff_all" on public.orders
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "order_items_staff_all" on public.order_items;
create policy "order_items_staff_all" on public.order_items
  for all using (public.is_staff()) with check (public.is_staff());

-- ============================================
-- Función: shop_variant_available — cuántas unidades quedan disponibles.
--
--   disponible = qty_on_hand
--              − Σ qty en órdenes que retienen stock
--
-- Retienen: pending_payment de los últimos 20 min (mismo hold que rentals),
-- reserved de las últimas 48 h, y paid aún no retiradas (sin límite: el cliente
-- ya pagó, la mercadería es suya). 'picked_up' NO retiene: ya bajó qty_on_hand.
-- ============================================
create or replace function public.shop_variant_available(p_variant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select i.qty_on_hand from public.inventory i where i.variant_id = p_variant_id),
    0
  ) - coalesce(
    (
      select sum(oi.qty)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.variant_id = p_variant_id
        and (
          (o.status = 'pending_payment' and o.created_at > now() - interval '20 minutes')
          or (o.status = 'reserved' and o.created_at > now() - interval '48 hours')
          or (o.status = 'paid' and o.picked_up_at is null)
        )
    ),
    0
  );
$$;

revoke all on function public.shop_variant_available(uuid) from public;
grant execute on function public.shop_variant_available(uuid)
  to anon, authenticated, service_role;

-- ============================================
-- Función: list_shop_catalog — catálogo público.
-- Una fila por VARIANTE activa de producto activo (mismo criterio que
-- list_available_units: la app agrupa por producto). Incluye disponibilidad.
-- ============================================
create or replace function public.list_shop_catalog(p_category text default null)
returns table (
  product_id uuid,
  slug text,
  name text,
  category text,
  brand text,
  description text,
  image_urls text[],
  has_variants boolean,
  featured boolean,
  sort_order integer,
  variant_id uuid,
  sku text,
  label text,
  price numeric,
  available integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.slug, p.name, p.category, p.brand, p.description, p.image_urls,
    p.has_variants, p.featured, p.sort_order,
    v.id, v.sku, v.label,
    coalesce(v.price_override, p.price),
    public.shop_variant_available(v.id)
  from public.products p
  join public.product_variants v on v.product_id = p.id
  where p.active = true
    and v.active = true
    and (p_category is null or p.category = p_category)
  order by p.featured desc, p.sort_order, p.name, v.sort_order, v.label;
$$;

revoke all on function public.list_shop_catalog(text) from public;
grant execute on function public.list_shop_catalog(text)
  to anon, authenticated, service_role;

-- ============================================
-- Función: shop_low_stock — variantes bajo su punto de reposición.
-- La usa la vista Inventory del panel. Staff-only.
-- ============================================
create or replace function public.shop_low_stock()
returns table (
  variant_id uuid,
  sku text,
  product_name text,
  label text,
  qty_on_hand integer,
  reorder_point integer
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.sku, p.name, v.label, i.qty_on_hand, i.reorder_point
  from public.inventory i
  join public.product_variants v on v.id = i.variant_id
  join public.products p on p.id = v.product_id
  where public.is_staff()
    and v.active = true
    and i.reorder_point is not null
    and i.qty_on_hand <= i.reorder_point
  order by (i.qty_on_hand - i.reorder_point), p.name;
$$;

revoke all on function public.shop_low_stock() from public;
grant execute on function public.shop_low_stock() to authenticated, service_role;

-- ============================================
-- Función: create_pos_sale — la venta de mostrador, en UNA transacción.
--
-- Una venta toca dinero (payments) y stock (inventory_moves) a la vez. Si eso
-- se hiciera con varios inserts desde el server y uno fallara, quedaría una
-- venta a medias: cobrada sin descontar, o descontada sin cobrar. Acá es todo
-- o nada.
--
-- El precio NUNCA viene del cliente: se lee de la variante/producto.
-- El total se compara contra lo cobrado y, si no cuadra, la venta se revierte.
--
-- La orden nace en 'picked_up' (en el mostrador cobrar y entregar son el mismo
-- momento), que es exactamente lo que hace bajar el stock.
--
-- p_items:    [{"variant_id": uuid, "qty": int, "discount": numeric}]
-- p_payments: [{"method": "cash"|"card", "amount": numeric}]
-- ============================================
create or replace function public.create_pos_sale(
  p_reference text,
  p_staff_id uuid,
  p_shift_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_staff_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_pay jsonb;
  v_v record;
  v_qty integer;
  v_discount numeric(10, 2);
  v_unit_price numeric(10, 2);
  v_line_total numeric(10, 2);
  v_subtotal numeric(10, 2) := 0;
  v_discount_total numeric(10, 2) := 0;
  v_total numeric(10, 2) := 0;
  v_paid numeric(10, 2) := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart';
  end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then
    raise exception 'no_payment';
  end if;

  insert into public.orders (
    reference, channel, customer_id, status,
    sold_by, handed_over_by, shift_id, picked_up_at, staff_note
  )
  values (
    p_reference, 'pos', p_customer_id, 'picked_up',
    p_staff_id, p_staff_id, p_shift_id, now(), p_staff_note
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select v.id, v.sku, v.label, v.price_override, p.name as product_name, p.price
      into v_v
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = (v_item ->> 'variant_id')::uuid;
    if not found then
      raise exception 'variant_not_found:%', v_item ->> 'variant_id';
    end if;

    v_qty := greatest(1, coalesce((v_item ->> 'qty')::integer, 1));
    v_discount := greatest(0, coalesce((v_item ->> 'discount')::numeric, 0));
    v_unit_price := coalesce(v_v.price_override, v_v.price);
    v_line_total := greatest(0, round(v_unit_price * v_qty - v_discount, 2));

    insert into public.order_items (
      order_id, variant_id, name_snapshot, sku_snapshot,
      unit_price, qty, discount, line_total
    )
    values (
      v_order_id, v_v.id,
      v_v.product_name || case when v_v.label = 'Único' then '' else ' — ' || v_v.label end,
      v_v.sku, v_unit_price, v_qty, v_discount, v_line_total
    );

    -- Salida de stock. El trigger de inventory_moves aplica el delta.
    insert into public.inventory_moves (
      variant_id, delta, reason, related_type, related_id, created_by
    )
    values (v_v.id, -v_qty, 'sale', 'order', v_order_id, p_staff_id);

    v_subtotal := v_subtotal + round(v_unit_price * v_qty, 2);
    v_discount_total := v_discount_total + v_discount;
    v_total := v_total + v_line_total;
  end loop;

  for v_pay in select value from jsonb_array_elements(p_payments) loop
    if (v_pay ->> 'method') not in ('cash', 'card') then
      raise exception 'bad_method:%', v_pay ->> 'method';
    end if;
    insert into public.payments (
      provider, amount, currency, status, paid_at,
      related_type, related_id, collected_by, shift_id
    )
    values (
      (v_pay ->> 'method'), round((v_pay ->> 'amount')::numeric, 2), 'USD', 'paid', now(),
      'order', v_order_id, p_staff_id, p_shift_id
    );
    v_paid := v_paid + round((v_pay ->> 'amount')::numeric, 2);
  end loop;

  -- Si lo cobrado no cuadra con el total, se cae todo (transacción).
  if v_paid <> v_total then
    raise exception 'payment_mismatch:% vs %', v_paid, v_total;
  end if;

  update public.orders
     set subtotal = v_subtotal,
         discount_total = v_discount_total,
         total = v_total
   where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_pos_sale(text, uuid, uuid, jsonb, jsonb, uuid, text) from public;
grant execute on function public.create_pos_sale(text, uuid, uuid, jsonb, jsonb, uuid, text)
  to service_role;

-- ============================================
-- Seed opcional — catálogo de ejemplo para desarrollo.
-- Reemplazar por los ~50 productos reales antes de producción.
-- (La variante 'Único' y la fila de inventory las crean los triggers.)
-- ============================================
/*
insert into public.products (name, slug, category, price, featured, sort_order)
values
  ('Surf wax tropical',      'surf-wax-tropical',   'wax',       6,  true,  1),
  ('Leash 6''',              'leash-6',             'leash',    25,  true,  2),
  ('Bloqueador reef-safe',   'bloqueador-reef-safe','sunscreen',18,  true,  3),
  ('Bolsa estanca 10L',      'bolsa-estanca-10l',   'bags',     22, false,  4)
on conflict (slug) do nothing;

-- Stock inicial: SIEMPRE por movimiento, nunca update directo.
insert into public.inventory_moves (variant_id, delta, reason, note)
select v.id, 10, 'purchase', 'Carga inicial de desarrollo'
from public.product_variants v;
*/
