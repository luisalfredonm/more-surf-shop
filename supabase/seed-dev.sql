-- ============================================
-- More Surf Shop — Seed de desarrollo / demo
-- Correr en Supabase SQL Editor DESPUÉS de:
--   schema.sql · schema-bookings.sql · schema-scheduling.sql
-- Deja el flujo de reserva funcionando para probar.
--
-- AJUSTAR precios, nombres y descripciones a los reales antes de producción
-- (panel /staff → Prices & Services). Los bloques de class_types / instructors
-- solo insertan si la tabla está vacía de ese tipo, así que es seguro reejecutar.
-- ============================================

-- ---- 3 tipos de lección ----
insert into public.class_types
  (name, category, price_per_person, ratio_label, description, included, badge, cta_label,
   sort_order, min_guests, max_guests, duration_min, max_capacity)
select v.*
from (values
  ('Group Surf Lesson', 'lesson', 55::numeric, 'Hasta 4 personas por instructor',
   'Opción social y económica. Ratio chico, olas amigables, atención personal.',
   array['Tabla soft-top','Licra','Instructor certificado','Locker','Ducha'],
   null::text, 'Reservar clase grupal', 1, 1, 4, 90, 12),
  ('Semi-Private Surf Lesson', 'lesson', 70::numeric, '2 o 3 personas, un instructor',
   'La misma atención que la privada, repartida entre vos y tu grupo.',
   array['Todo lo de la privada, por persona'],
   'Más elegida', 'Reservar semi-privada', 2, 2, 3, 90, 6),
  ('Private Surf Lesson', 'lesson', 90::numeric, 'Una persona, un instructor',
   'La forma más rápida de avanzar. Instructor a tu lado toda la sesión.',
   array['Tabla soft-top','Licra','Instructor dedicado','Locker','Ducha','Briefing de seguridad'],
   null::text, 'Reservar privada', 3, 1, 1, 90, 4)
) as v(name, category, price_per_person, ratio_label, description, included, badge, cta_label,
       sort_order, min_guests, max_guests, duration_min, max_capacity)
where not exists (select 1 from public.class_types where category = 'lesson');

-- ---- Instructores (nombres de ejemplo — reemplazar) ----
insert into public.instructors (name, years_teaching, certifications, languages, bio, sort_order)
select v.*
from (values
  ('Instructor 1', 8, array['ISA'], array['English','Spanish'], 'Bio pendiente.', 1),
  ('Instructor 2', 5, array['ISA'], array['English','Spanish'], 'Bio pendiente.', 2)
) as v(name, years_teaching, certifications, languages, bio, sort_order)
where not exists (select 1 from public.instructors);

-- ---- Plantilla semanal: todos los días, 07:00 / 09:30 / 11:00 para cada servicio ----
insert into public.weekly_slots (class_type_id, weekday, start_time)
select ct.id, wd.d, t.st
from public.class_types ct
cross join generate_series(0, 6) as wd(d)
cross join (values ('07:00'::time), ('09:30'::time), ('11:00'::time)) as t(st)
where ct.active and ct.category = 'lesson'
on conflict (class_type_id, weekday, start_time) do nothing;

-- ---- Chequeo rápido de estado ----
select
  (select count(*) from public.class_types where category = 'lesson' and price_per_person > 0) as lecciones_con_precio,
  (select count(*) from public.instructors where active) as instructores,
  (select count(*) from public.weekly_slots where active) as slots_semanales,
  (select count(*) from public.profiles where active) as usuarios_panel;
