-- ============================================
-- More Surf Shop — Seed de desarrollo / demo
-- Correr en Supabase SQL Editor DESPUÉS de schema.sql y schema-bookings.sql.
-- Deja el flujo de reserva funcionando para probar.
--
-- AJUSTAR precios, nombres y descripciones a los reales antes de producción
-- (Table Editor). Cada bloque solo inserta si la tabla está vacía de ese tipo,
-- así que es seguro reejecutarlo.
-- ============================================

-- ---- 3 tipos de lección ----
insert into public.class_types
  (name, category, price_per_person, ratio_label, description, included, badge, cta_label, sort_order, min_guests, max_guests)
select v.*
from (values
  ('Group Surf Lesson', 'lesson', 55::numeric, 'Hasta 4 personas por instructor',
   'Opción social y económica. Ratio chico, olas amigables, atención personal.',
   array['Tabla soft-top','Licra','Instructor certificado','Locker','Ducha'],
   null::text, 'Reservar clase grupal', 1, 1, 4),
  ('Semi-Private Surf Lesson', 'lesson', 70::numeric, '2 o 3 personas, un instructor',
   'La misma atención que la privada, repartida entre vos y tu grupo.',
   array['Todo lo de la privada, por persona'],
   'Más elegida', 'Reservar semi-privada', 2, 2, 3),
  ('Private Surf Lesson', 'lesson', 90::numeric, 'Una persona, un instructor',
   'La forma más rápida de avanzar. Instructor a tu lado toda la sesión.',
   array['Tabla soft-top','Licra','Instructor dedicado','Locker','Ducha','Briefing de seguridad'],
   null::text, 'Reservar privada', 3, 1, 1)
) as v(name, category, price_per_person, ratio_label, description, included, badge, cta_label, sort_order, min_guests, max_guests)
where not exists (select 1 from public.class_types where category = 'lesson');

-- ---- Instructores (nombres de ejemplo — reemplazar) ----
insert into public.instructors (name, years_teaching, certifications, languages, bio, sort_order)
select v.*
from (values
  ('Instructor 1', 8, array['ISA'], array['English','Spanish'], 'Bio pendiente.', 1),
  ('Instructor 2', 5, array['ISA'], array['English','Spanish'], 'Bio pendiente.', 2)
) as v(name, years_teaching, certifications, languages, bio, sort_order)
where not exists (select 1 from public.instructors);

-- ---- Abrir slots para los próximos 10 días ----
-- Grupal 07:00 y 09:30 (cap 4)
select public.open_lesson_slots(
  (select array_agg((current_date + g)::date) from generate_series(1, 10) g),
  array['07:00','09:30']::time[],
  (select id from public.class_types where name = 'Group Surf Lesson' limit 1),
  null,
  4
) as slots_grupales_creados;

-- Privada 08:00 y 10:00 (cap 1)
select public.open_lesson_slots(
  (select array_agg((current_date + g)::date) from generate_series(1, 10) g),
  array['08:00','10:00']::time[],
  (select id from public.class_types where name = 'Private Surf Lesson' limit 1),
  null,
  1
) as slots_privados_creados;

-- ---- Chequeo rápido de estado ----
select
  (select count(*) from public.class_types where category = 'lesson' and price_per_person > 0) as lecciones_con_precio,
  (select count(*) from public.instructors where active) as instructores,
  (select count(*) from public.lesson_slots where slot_date >= current_date and status = 'open') as slots_abiertos_futuros,
  (select count(*) from public.profiles where active) as usuarios_panel;
