-- ============================================
-- More Surf Shop — Seed de DEMO para Rentals
-- Correr en Supabase SQL Editor DESPUÉS de schema-rentals.sql.
-- Crea 2 modelos + 4 tablas + 4 alquileres de ejemplo para ver todos los
-- estados del panel (Afuera ahora / vencida / confirmada / devuelta).
--
-- Los modelos quedan `active = false` para NO aparecer en el sitio público.
-- Es seguro reejecutar: todo va con prefijo DEMO- y guardas.
-- Para borrar la demo, ver el bloque al final.
-- ============================================

do $$
declare
  v_model_st uuid;
  v_model_lb uuid;
  v_u1 uuid; v_u2 uuid; v_u3 uuid; v_u4 uuid;
  v_cust uuid;
  v_staff uuid;
  v_grp uuid;
  v_waiver uuid;
begin
  select id from public.profiles where active = true limit 1 into v_staff;

  -- ---- Modelos (inactivos: no salen en el sitio) ----
  insert into public.board_models (name, slug, category, length_label, skill_level, price_per_hour, price_per_day, active, sort_order)
  values ('DEMO Soft-top 8''0', 'demo-softtop-8-0', 'softtop', '8''0', 'beginner', 8, 20, false, 900)
  on conflict (slug) do nothing;
  insert into public.board_models (name, slug, category, length_label, skill_level, price_per_hour, price_per_day, active, sort_order)
  values ('DEMO Longboard 9''0', 'demo-longboard-9-0', 'longboard', '9''0', 'all', 10, 25, false, 901)
  on conflict (slug) do nothing;

  select id from public.board_models where slug = 'demo-softtop-8-0' into v_model_st;
  select id from public.board_models where slug = 'demo-longboard-9-0' into v_model_lb;

  -- ---- Unidades ----
  insert into public.board_units (model_id, code, default_fins, status) values (v_model_st, 'DEMO-ST-1', 1, 'available') on conflict (code) do nothing;
  insert into public.board_units (model_id, code, default_fins, status) values (v_model_st, 'DEMO-ST-2', 1, 'available') on conflict (code) do nothing;
  insert into public.board_units (model_id, code, default_fins, status) values (v_model_lb, 'DEMO-LB-1', 3, 'available') on conflict (code) do nothing;
  insert into public.board_units (model_id, code, default_fins, status) values (v_model_lb, 'DEMO-LB-2', 3, 'available') on conflict (code) do nothing;

  select id from public.board_units where code = 'DEMO-ST-1' into v_u1;
  select id from public.board_units where code = 'DEMO-ST-2' into v_u2;
  select id from public.board_units where code = 'DEMO-LB-1' into v_u3;
  select id from public.board_units where code = 'DEMO-LB-2' into v_u4;

  -- ---- Cliente ----
  select id from public.customers where email = 'demo.renter@example.com' limit 1 into v_cust;
  if v_cust is null then
    insert into public.customers (full_name, email, phone)
    values ('Demo Renter', 'demo.renter@example.com', '+506 8888-0000')
    returning id into v_cust;
  end if;

  -- Si ya hay alquileres DEMO, no duplicar.
  if exists (select 1 from public.rentals where reference like 'RNT-DEMO%') then
    raise notice 'Ya hay alquileres DEMO — nada que hacer.';
    return;
  end if;

  -- Un grupo por alquiler (así el /booking lookup funciona con cada código).
  insert into public.booking_groups (reference, customer_id, total_amount, currency, payment_method, status)
  values ('GRP-DEMO1', v_cust, 20, 'USD', 'on_arrival', 'confirmed') returning id into v_grp;

  -- Waiver de ejemplo para el chip "Waiver".
  insert into public.waivers (customer_id, waiver_version, activity, signer_name_typed, accepted_terms, rendered_text_snapshot, lang)
  values (v_cust, '2026-09-06', 'rental', 'Demo Renter', true, '(demo waiver snapshot)', 'en')
  returning id into v_waiver;

  -- 1) AFUERA AHORA (no vencida): salió hace 4h, vuelve en 20h
  insert into public.rentals
    (reference, group_id, customer_id, unit_id, model_id, start_at, end_at, rate_type, units_billed,
     unit_price, total_amount, status, payment_method, waiver_id, source, fins_out,
     picked_up_at, checked_out_by, staff_note)
  values
    ('RNT-DEMO1', v_grp, v_cust, v_u1, v_model_st, now() - interval '4 hours', now() + interval '20 hours',
     'day', 1, 20, 20, 'picked_up', 'cash', v_waiver, 'walk_in', 1,
     now() - interval '4 hours', v_staff, 'Demo — afuera ahora');

  -- Pago cash de esa (para el badge "paid")
  insert into public.payments (provider, amount, currency, status, paid_at, related_type, related_id)
  values ('cash', 20, 'USD', 'paid', now() - interval '4 hours', 'rental_reservation', (select id from public.rentals where reference = 'RNT-DEMO1'));
  update public.rentals set payment_id = (select id from public.payments where related_id = (select id from public.rentals where reference = 'RNT-DEMO1') limit 1)
  where reference = 'RNT-DEMO1';

  -- 2) VENCIDA: salió hace 2 días, tenía que volver hace 3h -> bandera roja + "1 vencidas"
  insert into public.booking_groups (reference, customer_id, total_amount, currency, payment_method, status)
  values ('GRP-DEMO2', v_cust, 50, 'USD', 'on_arrival', 'confirmed') returning id into v_grp;
  insert into public.rentals
    (reference, group_id, customer_id, unit_id, model_id, start_at, end_at, rate_type, units_billed,
     unit_price, total_amount, status, payment_method, source, fins_out, picked_up_at, checked_out_by, staff_note)
  values
    ('RNT-DEMO2', v_grp, v_cust, v_u3, v_model_lb, now() - interval '2 days', now() - interval '3 hours',
     'day', 2, 25, 50, 'picked_up', 'on_arrival', 'walk_in', 3,
     now() - interval '2 days', v_staff, 'Demo — vencida, sin pagar');

  -- 3) CONFIRMADA sin retirar: retiro en ~22h (dispara el recordatorio del cron)
  insert into public.booking_groups (reference, customer_id, total_amount, currency, payment_method, status)
  values ('GRP-DEMO3', v_cust, 20, 'USD', 'on_arrival', 'confirmed') returning id into v_grp;
  insert into public.rentals
    (reference, group_id, customer_id, unit_id, model_id, start_at, end_at, rate_type, units_billed,
     unit_price, total_amount, status, payment_method, source, staff_note)
  values
    ('RNT-DEMO3', v_grp, v_cust, v_u2, v_model_st, now() + interval '22 hours', now() + interval '2 days',
     'day', 1, 20, 20, 'confirmed', 'on_arrival', 'web', 'Demo — reservada online, retira mañana');

  -- 4) DEVUELTA: historial de la hoja de vida
  insert into public.booking_groups (reference, customer_id, total_amount, currency, payment_method, status)
  values ('GRP-DEMO4', v_cust, 20, 'USD', 'on_arrival', 'confirmed') returning id into v_grp;
  insert into public.rentals
    (reference, group_id, customer_id, unit_id, model_id, start_at, end_at, rate_type, units_billed,
     unit_price, total_amount, status, payment_method, source, fins_out, fins_in,
     condition_in_notes, picked_up_at, returned_at, checked_out_by, checked_in_by, staff_note)
  values
    ('RNT-DEMO4', v_grp, v_cust, v_u1, v_model_st, now() - interval '5 days', now() - interval '4 days',
     'day', 1, 20, 20, 'returned', 'cash', 'walk_in', 1, 1,
     'Devuelta ok, sin daños', now() - interval '5 days', now() - interval '4 days', v_staff, v_staff,
     'Demo — devuelta (historial)');

  raise notice 'Demo creada: RNT-DEMO1 (afuera), RNT-DEMO2 (vencida), RNT-DEMO3 (confirmada), RNT-DEMO4 (devuelta).';
end $$;

-- ============================================
-- Chequeo
-- ============================================
select reference, status, start_at, end_at
from public.rentals where reference like 'RNT-DEMO%' order by reference;

-- ============================================
-- Para BORRAR toda la demo (descomentar y correr):
-- ============================================
/*
delete from public.payments where related_id in (select id from public.rentals where reference like 'RNT-DEMO%');
delete from public.rentals where reference like 'RNT-DEMO%';
delete from public.booking_groups where reference like 'GRP-DEMO%';
delete from public.waivers where rendered_text_snapshot = '(demo waiver snapshot)';
delete from public.board_units where code like 'DEMO-%';
delete from public.board_models where slug like 'demo-%';
delete from public.customers where email = 'demo.renter@example.com';
*/
