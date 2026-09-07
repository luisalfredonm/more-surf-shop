# Etapa 2 — Plan · Rentals de tablas

> Estado: **decisiones principales cerradas** (§12). Listo para arrancar por
> schema + Fleet. Quedan pendientes que no bloquean: texto de T&C, precios reales,
> lista de categorías, confirmar cámara en la tablet.
> Fecha: 2026-09-06.

---

## 1. Alcance

**Solo rentals de tablas.** Tours y tienda quedan fuera de esta etapa.

Dos vías, que convergen en los mismos registros:

1. **Online** — la persona busca una tabla, reserva un rango de fechas y **paga la
   reserva en línea** (PayPal). *(nuevo)*
2. **Mostrador (walk-in)** — la persona llega a la tienda, elige su tabla, el staff
   registra el alquiler, la persona **firma el waiver/términos en un dispositivo** y
   **paga en la tienda** (efectivo / tarjeta / link PayPal). *(hoy es 100% en papel
   — reemplaza el cuaderno)*

### Numeración canónica (el README quedó desincronizado)

| Fase | Alcance | Estado |
| ---- | ------- | ------ |
| **Fase 1** | Reservas de lecciones · PayPal / pago al llegar · panel de staff · check-in + waiver digital | ✅ construido |
| **Fase 2** *(este plan)* | **Rentals de tablas** — online + mostrador, con hoja de vida digital por tabla | ⏳ planificación |
| **Fase 3+** | Tours · tienda de accesorios · i18n EN · app móvil · OCR de cédula · analítica | futuro |

---

## 2. Estado actual — la hoja de papel

`HOJA DE VIDA TABLA <id>` (ej. "6.2 Ap"): **una hoja por tabla física**, una fila
por alquiler. Columnas:

| Columna | Quién | Momento | Significado |
| ------- | ----- | ------- | ----------- |
| FECHA / DATE | staff | salida | fecha del alquiler |
| TIME OUT | staff | salida | hora de retiro |
| Firma Staff | staff | salida | quién entregó |
| DINGS YES/NO | staff | salida | estado de la tabla al entregar |
| How many FINS included | staff | salida | quillas entregadas |
| I read and agree to the terms and conditions on the back of this page | **cliente** | salida | acepta los T&C (texto al dorso) |
| Rented for Duration | **cliente** | salida | duración contratada |
| CLIENT'S NAME | **cliente** | salida | nombre |
| DATE / TIME IN | staff | devolución | fecha y hora de regreso |
| DINGS | staff | devolución | estado al devolver |
| FINS | staff | devolución | quillas devueltas |
| FIRMA STAFF | staff | devolución | quién recibió |

Observaciones que definen el modelo:

- **Se rastrea por tabla individual**, no por tipo. Cada tabla tiene un `code`
  (ej. "6.2 Ap") — el mismo que irá en el QR. Online también se elige la tabla exacta.
- **Chequeo de condición** (fins + estado) a la **salida** y a la **entrada** — en
  el sistema pasa a ser **foto + nota + nº de fins**.
- Los **T&C están "al dorso"** — se integran al waiver existente bajo
  `activity='rental'` (ver §9).
- **No hay columna de precio ni de depósito** en la hoja — el precio lo calcula el
  sistema (tarifa/hora o /día); el depósito se maneja con copia de tarjeta, fuera
  del sistema.

---

## 3. Infraestructura reutilizable (ya existe)

| Pieza | Uso en rentals |
| ----- | -------------- |
| `customers` | persona única, find-or-create por email |
| `payments` | `related_type` **ya incluye** `rental_reservation` y `booking_group`; `provider` paypal/cash/sinpe/tilopay |
| `waivers` + `CheckinModal` | `activity` **ya incluye** `rental` y `both`; `getWaiverClauses(activity)` interpola la actividad; flujo de firma en el mostrador ya hecho |
| `booking_groups` | checkout `GRP-XXXXX` con `total_amount` / `payment_method` / `status` |
| `src/lib/paypal.ts` | `createOrder` / `captureOrder` / `refundCapture`, genérico sobre `group_id` |
| `src/lib/email.ts` → `sendBookingGroupEmails` | confirmación + recordatorio (hoy arma la lista **sólo** desde `bookings` — ver §7) |
| `src/lib/ratelimit.ts` | endpoints públicos |
| Panel staff (`StaffApp.tsx`, `AgendaView`, `PricesView`, `NewBookingForm`, `CheckinModal`) | patrón para las vistas nuevas |
| `src/pages/api/cron/*` | `reminders` + `cleanup` de `pending_payment` |
| `/surfboard-rental-tamarindo` (scaffold `noindex`) | se convierte en página real; quitar `noindex` al lanzar |

---

## 4. Modelo de datos — `supabase/schema-rentals.sql`

Cuatro tablas nuevas + reuso de las compartidas.

> **Decidido:** online se elige **la tabla exacta** (unidad), no un modelo. El
> `board_model` sigue existiendo para las specs/fotos/tarifas compartidas y las
> páginas de categoría SEO, pero lo reservable es la `board_unit`.

### 4.1 `board_models` — specs + tarifas compartidas

```
board_models
  id, name, slug, category ('softtop'|'longboard'|'funboard'|'shortboard'|'fish'|'sup'),
  length_label text,               -- "6'2", "9'0"
  volume_l numeric null,
  skill_level ('beginner'|'intermediate'|'advanced'|'all'),
  description text, image_urls text[],
  price_per_hour numeric not null,
  price_per_day numeric not null,
  -- semana = price_per_day * 7 (calculado, sin columna)
  active bool, featured bool, sort_order, timestamps
-- RLS: lectura pública de activos (como class_types).
-- Sin depósito: se maneja con copia de tarjeta en el mostrador, fuera del sistema.
```

### 4.2 `board_units` — inventario físico reservable (la "hoja de vida")

```
board_units
  id, model_id → board_models (restrict),
  code text unique not null,        -- "6.2 Ap"  (el nº de tabla de la hoja de papel + del QR)
  nickname text null,
  photo_url text null,              -- foto de catálogo de esta tabla puntual
  default_fins int not null default 3,
  status ('available'|'maintenance'|'retired') default 'available',
  condition_notes text null,        -- estado general / historial resumido
  acquired_at date null, timestamps
-- RLS: staff-only. La disponibilidad pública se calcula en el server.
```

### 4.3 `rentals` — un alquiler; es una fila de la hoja de vida de la unidad

```
rentals
  id, reference ('RNT-XXXXX') unique,
  group_id → booking_groups (set null),
  customer_id → customers (restrict),
  unit_id → board_units (restrict),            -- la tabla exacta (online y walk-in)
  model_id → board_models (restrict),          -- snapshot del modelo de esa unidad
  start_at timestamptz not null,               -- retiro
  end_at timestamptz not null,                 -- devolución prevista
  rate_type ('hour'|'day'|'week'),
  units_billed int not null,                   -- nº de horas/días/semanas
  unit_price numeric not null,                 -- snapshot de la tarifa aplicada
  total_amount numeric not null,
  currency text default 'USD',
  status ('pending_payment'|'confirmed'|'picked_up'|'returned'|'cancelled'|'no_show'),
  payment_method ('paypal'|'on_arrival'|'cash'),
  payment_id → payments (set null),
  waiver_id → waivers (set null),
  source ('web'|'walk_in'|'whatsapp'|'phone') default 'web',
  -- chequeo de condición (reemplaza dings/fins de la hoja) — foto desde v1
  fins_out int null,  condition_out_photo_url text null,  condition_out_notes text null,
  fins_in  int null,  condition_in_photo_url  text null,  condition_in_notes  text null,
  damage_reported bool default false,  damage_fee numeric null,
  picked_up_at timestamptz null,  returned_at timestamptz null,
  checked_out_by → profiles (set null),  checked_in_by → profiles (set null),
  customer_note text, staff_note text,
  confirmation_sent_at timestamptz, reminder_sent_at timestamptz, timestamps
-- RLS: staff-only.
```

La **hoja de vida digital de una tabla** = `select * from rentals where unit_id = ?
order by start_at desc`.

**Fotos de condición:** bucket de Supabase Storage `rental-photos` (privado, RLS
staff). Sube el staff desde la tablet en la entrega y en la devolución. El cliente
no sube nada.

### 4.4 `rental_settings` — configuración editable por el staff (fila única)

```
rental_settings   (id smallint primary key default 1 check (id = 1))
  min_duration_hours int not null default 1,
  max_duration_days int not null default 30,
  min_lead_hours int not null default 0,        -- antelación mínima de reserva online
  min_charge_unit ('hour'|'day') not null default 'hour',
  duration_presets jsonb not null default
    '[{"label":"2 h","kind":"hour","qty":2},
      {"label":"4 h","kind":"hour","qty":4},
      {"label":"1 día","kind":"day","qty":1},
      {"label":"2 días","kind":"day","qty":2},
      {"label":"1 semana","kind":"week","qty":1}]',
  updated_at timestamptz
-- RLS: lectura pública (la usa el widget online); escritura staff-only.
```

Las **tarifas** las define el staff en la vista **Fleet** (por `board_model`); las
**duraciones / presets / antelación** en la vista **Rental settings** (esta tabla).

### 4.5 Disponibilidad (por unidad)

- `is_unit_available(p_unit_id uuid, p_from timestamptz, p_to timestamptz) → bool`
  — `board_units.status = 'available'` **y** no hay `rentals` de esa unidad con
  `status in ('confirmed','picked_up')` (o `'pending_payment'` de los últimos
  ~20 min) cuyo `[start_at, end_at]` se solape con `[p_from, p_to]`.
- `list_available_units(p_category text, p_from timestamptz, p_to timestamptz)`
  — para el catálogo: unidades activas de esa categoría que pasan `is_unit_available`,
  con su modelo, specs y tarifas.

Ambas `security definer`, igual que `get_available_slots`.

---

## 5. Vía online

### Rutas públicas y SEO

Online se elige la tabla exacta, pero **no** conviene una URL indexable por tabla
física (15 páginas casi idénticas de "9'0 longboard" = contenido duplicado /
doorway). Estructura:

- `/surfboard-rental-tamarindo` — **hub indexable**: hero + cómo funciona +
  categorías + tarifas + FAQ + `Service` / `FAQPage` JSON-LD + el widget. Quitar `noindex`.
- `/surfboard-rental-tamarindo/[category]` — **página de categoría indexable**
  (`softtops`, `longboards`, `shortboards`, …): ataca "longboard rental tamarindo"
  etc. Lista las tablas de esa categoría con foto, specs y disponibilidad. `Service`
  + `ItemList` JSON-LD.
- Cada **tabla** es una card dentro de la categoría; deep-link `?board=<code>` para
  compartir/reservar una puntual, **con `noindex`** (evita el contenido fino).

### Widget (isla React, espejo de `BookingFlow.tsx`)

Categoría → fechas/horas de retiro y devolución → lista de **tablas disponibles**
en ese rango (con su tarifa) → elegir una → contacto → PayPal (o "pago al retirar").

### API

- `GET /api/rentals/availability?category=&from=&to=` → lista de unidades
  disponibles `{ code, model, specs, rate_type, unit_price, units_billed, subtotal }`.
- `GET /api/rentals/quote?unit_id=&from=&to=` → precio de una unidad puntual
  (revalida disponibilidad).
- `POST /api/rentals/create` — revalida disponibilidad + precio en el server,
  find-or-create customer, crea `booking_group` + `rentals` (`status` =
  `pending_payment` si PayPal, `confirmed` si `on_arrival`). Espejo de `bookings/create.ts`.
  Soporta **varias tablas en un mismo checkout** (carrito solo de rentas).
- `capture.ts` / `refund.ts` — extender para actualizar `rentals` del grupo (§7).

El pago online cubre el **alquiler**. El **depósito** no lo toca el sistema (copia
de tarjeta en el mostrador).

---

## 6. Vía mostrador (walk-in) — 3 momentos

El form "todo en uno" (buscar tabla + cliente + waiver del cliente + condición +
pago, un submit) quedó sobrecargado. Se separó en **reservar / entregar /
recibir**, igual que las lecciones (`create` → `checkin` → `completed`).

```
RESERVAR   (NewRentalForm + /api/rentals/create)      → rental status = confirmed
  tabla (o QR) + FECHA/HORA de retiro + duración (chips) + cliente + nota
  Botones: "Reservar"  ·  "Reservar y entregar"

ENTREGAR   (RentalCheckoutModal + /api/rentals/checkout, staff-only)  → picked_up
  pantalla enfocada, se le pasa la tablet al cliente:
  - condición de salida: fins (default de la tabla) + FOTO + nota
  - waiver: contacto de emergencia · ¿menor? → firma el tutor · texto + firma (SignaturePad) + "acepto"
  - cobro en efectivo opcional (si no está pago)
  → waiver_id, picked_up_at, checked_out_by

RECIBIR    (ReturnRentalModal + /api/rentals/return)  → returned
  fins de entrada + foto + daño/cargo + cobro del saldo
```

- **Walk-in "retira ahora"** = "Reservar y entregar" (crea el `confirmed` y abre
  el modal de entrega de una).
- **Reserva para otro día** = sólo "Reservar"; el staff hace "Entregar" cuando
  viene a buscar la tabla (botón en la Agenda, o escaneando el QR).
- El **escáner** enruta por estado: `confirmed` → entregar · `picked_up` → recibir.
- Una **reserva online** (`confirmed`) aparece igual en la Agenda con "Entregar":
  el mismo modal sirve para el retiro presencial de lo reservado por web.

### Devolución — objetivo < 20 segundos

1. Escanear QR / buscar por nº de tabla (o tocar la tabla en **"Afuera ahora"**).
2. Aparece su alquiler abierto. Confirmar fins (pre-lleno = las que entregó).
   **Foto de la tabla** a la entrada. Si hay daño → marcar `damage_reported` +
   nota + `damage_fee` opcional.
3. **"Recibir"** → `returned_at`, `checked_in_by`, `status = 'returned'`. Si era
   "pagar al devolver", se cobra ahora. Si hay `damage_fee`, se registra un
   `payment` extra. Tabla → `available`.

### Vista "Afuera ahora"

Reemplaza hojear el cuaderno: lista en vivo de cada tabla alquilada con cliente,
hora de devolución prevista y **bandera roja si está vencida**. De ahí salen los
recordatorios automáticos (§10).

### Realidad del mostrador

- Rentas abiertas ("lo traigo en la tarde"): la duración fija el **retorno
  previsto** y el precio base; si la traen más tarde, al recibir el sistema
  recalcula y el staff confirma el cobro extra.
- La "firma del staff" de la hoja = la cuenta de staff logueada. No firma nada.
- **Teléfono, no email obligatorio** en el mostrador — alcanza para crear al
  cliente y mandar recibo/recordatorio por WhatsApp.

### Hardware

Una tablet en el mostrador · stickers QR para la flota (costo casi cero) · el
datáfono que ya tienen (el sistema sólo registra "pagado con tarjeta") · impresora
de recibos opcional, o WhatsApp.

### Faseo de la vía mostrador

- **v1:** reservar (con fecha) + entregar (waiver + foto + cobro) + recibir +
  "Afuera ahora" + hoja de vida digital + escaneo QR.
- **Fase 3:** OCR de cédula/pasaporte, cobro automático de daño, depósito con
  autorización PayPal, "reusar firma anterior" para clientes repetidos, recibo
  por WhatsApp.

---

## 7. Refactor transversal (chico, antes de la vía online)

`booking_groups` hoy asume grupo = N `bookings`. Para que checkout / PayPal /
email / cron / lookup sirvan también a rentals:

1. Extraer `confirmGroupLines(groupId)` / `cancelGroupLines(groupId)` que
   actualicen `bookings` **y** `rentals` del grupo (hoy `capture.ts` y `refund.ts`
   sólo tocan `bookings`).
2. Generalizar el builder de ítems de `sendBookingGroupEmails` (hoy sólo lee
   `bookings`) para incluir líneas de `rentals`.
3. `cleanup.ts` — limpiar `rentals` en `pending_payment` abandonados.
4. `/booking` (lookup) — mostrar rentals además de lecciones.

**Carrito solo de rentas** (decisión 5): un `booking_group` puede tener **varias
tablas**, pero nunca mezcla lecciones y rentas. El `booking_group` se reutiliza
igual; sus líneas son de un solo tipo por checkout.

---

## 8. Panel de staff — vistas nuevas

- **Rentals** — dos pestañas:
  - **Afuera ahora**: tablas alquiladas en vivo (cliente · devolución prevista ·
    bandera roja si vencida) + botón "Recibir".
  - **Agenda**: retiros y devoluciones por día · "Nuevo alquiler" (walk-in) ·
    estado de waiver (chip, reusa el viewer de Fase 1).
- **Fleet**: CRUD de `board_models` (**tarifa/hora + tarifa/día**, specs, fotos —
  como `PricesView`) y de `board_units` (`code`, modelo, fins default, `status`,
  foto). Ver la **hoja de vida** de una unidad (historial de `rentals` con las
  fotos de condición).
- **Rental settings**: editar `rental_settings` — duración mín/máx, antelación
  mínima, unidad mínima de cobro y los presets de duración (chips).
- `StaffApp.tsx` — sección "Rentals" en el sidebar (Rentals · Fleet · Settings).

---

## 9. Waiver / T&C de alquiler

**Decidido:** un solo documento — se agregan las cláusulas de alquiler (daño,
devolución tardía, pérdida de quillas) a [src/lib/waiver.ts](../src/lib/waiver.ts)
bajo `activity in ('rental','both')` y se sube `WAIVER_VERSION`. El waiver ya se
titula "Surf Lessons **and Surfboard Rentals**" y `getWaiverClauses(activity)`
interpola la actividad, así que la maquinaria de snapshot + firma del `CheckinModal`
ya sirve.

**Pendiente (bloquea el lanzamiento, no la construcción):** el usuario pasa el
texto real de los "terms and conditions on the back of this page" + revisión legal
CR antes de `PAYPAL_ENV=live`.

---

## 10. Cron

Extender `reminders.ts` ("tu retiro es mañana", "devolución hoy") y `cleanup.ts`.
Nuevo: barrido diario que marca **devoluciones vencidas** (`end_at < now()` y
`status = 'picked_up'`) para que el staff las vea.

---

## 11. Orden de construcción

1. ✅ **Schema** `schema-rentals.sql` (`board_models`, `board_units`, `rentals`,
   `rental_settings`) + `is_unit_available` / `list_available_units` + bucket
   Storage `rental-photos` + tipos en `src/lib/supabase.ts`. *(commit `a123ae2`)*
2. ✅ **Refactor transversal** (§7): `confirmGroupLines` / `cancelGroupLines`,
   `groupItems` en email, `cleanup` y `/booking` lookup con rentals. *(commit `fd69951`)*
3. ✅ **Panel staff — Fleet + Rental settings**: CRUD de modelos (tarifas) y
   unidades; editor de `rental_settings`. *(commit `e55044e`)*
4. ✅ **Panel staff — Rentals walk-in**: reservar / entregar / recibir (§6).
   `NewRentalForm` (reserva + fecha) → `/api/rentals/create`;
   `RentalCheckoutModal` (waiver + condición + cobro) → `/api/rentals/checkout`;
   `ReturnRentalModal` → `/api/rentals/return`; `RentalsView` ("Afuera ahora" +
   "Agenda" con "Entregar"/"Recibir") + `UnitHistoryModal` (hoja de vida).
   *(commits `2307356`, `29ee733`, `1b8e86b`)*
   *Falta correr `schema-rentals.sql` + la policy de `storage.objects` para las
   fotos (el bucket `rental-photos` ya está).*
5. ✅ **QR de la flota (v1.1)**: `QrStickersView` (hoja imprimible) +
   `QrScanner` (cámara + jsQR) enganchado en `NewRentalForm` y `RentalsView`.
   *(commit `f802647`)*
6. ✅ **Vía online**: `/api/rentals/availability` + `/api/rentals/book`,
   `RentalWidget`, hub `surfboard-rental-tamarindo.astro` (sin `noindex`) +
   páginas de categoría `[category].astro` + sitemap. *(commits `7113299`,
   `d321851`, `966f708`)*
7. ✅ **Cron**: `sendDueRentalReminders` (recordatorio de retiro ~24h antes) +
   `notifyOverdueRentals` (aviso de devolución vencida), colgados de
   `/api/cron/reminders`. *(commit `9d2b2e9`)*
8. **Prueba E2E** — 🟡 rutas nuevas smoke-tested OK contra Supabase real
   (`availability` 200, guards 401, páginas 200, redirect, sitemap). Falta la
   prueba manual: walk-in con login de staff (foto → bucket, waiver, pago,
   devolución, QR), online "pay at shop" + `/booking` lookup + email, cron con
   `CRON_SECRET`. PayPal online pendiente del sandbox.

Arrancar por 3–4 da valor aunque la parte online tarde: el shop deja el cuaderno
desde el primer release.

---

## 12. Decisiones — cerradas y pendientes

### Cerradas (2026-09-06)

| # | Decisión | Resuelto |
| - | -------- | -------- |
| 1 | Unidad vs modelo online | **Tabla exacta.** Online se elige la unidad. `board_model` queda para specs/tarifas/SEO. |
| 2 | Tarifa | **Por hora Y por día** (`rate_type` hour/day/week). |
| 3 | Semana | `price_per_day × 7` (calculado, sin columna). |
| 4 | Depósito | **Copia de tarjeta en el mostrador. El sistema no lo toca.** Sin campos de depósito. |
| 5 | Carrito | **Solo de rentas** (puede haber varias tablas en un checkout; nunca mezclado con lecciones). |
| 6 | T&C | **Un solo waiver** — cláusulas de alquiler en `waiver.ts` bajo `activity='rental'/'both'`. Texto lo pasa el usuario. |
| 7 | Duración mín/máx + antelación | **Configurable por el staff** en `rental_settings` (vista "Rental settings"). |
| 8 | Chequeo de condición | **Foto** de la tabla a la salida y a la entrada, desde v1 (bucket `rental-photos`) + nota + nº de fins. Sin campo "dings". |
| 9 | Walk-in sin pago inmediato | **Permitido** — "pagar al devolver" además de cobrar al entregar. |
| 11 | QR | Se implementa QR **y** búsqueda por nº de tabla. Escaneo en v1.1 (o v1 si los stickers están listos). |
| 12 | Presets de duración + unidad mínima de cobro | **Configurable por el staff** en `rental_settings` (`duration_presets`, `min_charge_unit`). |
| 13 | Recibo | WhatsApp · email · impreso — los tres opcionales. |
| 10 | Slug / URL (SEO) | Hub `/surfboard-rental-tamarindo` + páginas de **categoría** `/surfboard-rental-tamarindo/[category]` indexables; tabla puntual = deep-link `?board=<code>` con `noindex`. Se indexa al terminar la vía online. |

### Pendientes (no bloquean empezar por schema + Fleet)

- **Texto real** de los "terms and conditions on the back" + revisión legal CR
  antes de `PAYPAL_ENV=live`.
- **Precios reales** por modelo (tarifa/hora y tarifa/día) — se cargan en Fleet.
- **Lista de categorías** definitiva (`softtop`, `longboard`, `funboard`,
  `shortboard`, `fish`, `sup`, …).
- Confirmar que **la tablet del mostrador tiene cámara** (para foto de condición y QR).
- Datos de la flota real: `code` de cada tabla, modelo, fins default.

---

## 13. TODO — pendiente de decisión del dueño

### T1. Entrega fuera de la fecha reservada

**Problema:** una tabla reservada 10–12 sep entregada el 8 hoy se entrega tal cual
— `start_at`/`end_at` siguen en 10–12, se cobran 2 días, pero la tabla está
físicamente afuera desde el 8. Consecuencias: `is_unit_available` la ve libre del
8 al 10 (riesgo de doble reserva), "Afuera ahora" no la marca vencida hasta el 12,
y el cobro no refleja los días reales.

**Opciones a plantearle al dueño:**

| | Qué hace | Cuándo conviene |
| - | -------- | --------------- |
| A. Bloquear | "Entregar" deshabilitado si `now < start_at`; el staff edita la reserva primero | Máxima disciplina de datos |
| **B. Re-anclar** *(recomendada)* | Al entregar: `start_at = ahora`, `end_at = ahora + duración original`. Precio sin cambio | El cliente llegó antes y quiere sus 2 días desde hoy |
| C. Extender | `start_at = ahora`, `end_at` = fecha reservada original → cobra los días reales | El cliente quiere la tabla para todo su viaje |

Recomendación: **B por default + un toggle "extender hasta la fecha reservada
(+N días, +$X)" para el caso C.** Una sola regla en `/api/rentals/checkout`
(`start_at = now`, `end_at = now + Δoriginal`) cubre entrega adelantada y atrasada
y deja disponibilidad + vencidas siempre honestas.

### T2. Recálculo de días extra al recibir

La nota de §6 dice "si la traen más tarde, al recibir el sistema recalcula el
cobro extra" — **no está implementado.** Hoy `ReturnRentalModal` /
`/api/rentals/return` cobran daño y el saldo base, pero no cobran días de más si
la tabla vuelve después de `end_at`. Falta: en Recibir, mostrar "estuvo X días de
más · +$Y" y sumarlo al cobro. (Depende de qué se decida en T1.)
