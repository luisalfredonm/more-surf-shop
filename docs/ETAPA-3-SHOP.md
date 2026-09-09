# Etapa 3 — Plan · Tienda de accesorios (POS + escaparate)

> Estado: **decisiones principales cerradas** (§3). Listo para arrancar por schema + Shop.
> Quedan pendientes que no bloquean: fotos reales, precios reales, lista definitiva de
> productos y variantes, modelo de impresora.
> Fecha: 2026-09-09.

---

## 1. Alcance

**Venta de accesorios de la tienda.** Es la tercera pata del negocio, después de
lecciones (Fase 1) y alquiler de tablas (Etapa 2).

Dos superficies que comparten el mismo catálogo y el mismo stock:

1. **Mostrador (POS)** — el staff vende en la tienda, cobra efectivo o tarjeta,
   imprime un recibo, y la venta **entra al cierre de caja del turno**. Reemplaza
   la digitación diaria en QPOS.
2. **Pública (escaparate + retirá en tienda)** — la persona ve el catálogo, arma
   una orden y **la retira en la tienda**. Paga con PayPal o al retirar. **Sin envíos.**

**Fuera de alcance de esta etapa:** facturación electrónica, envíos/courier, costos
y márgenes, devoluciones formales con nota de crédito, lector de código de barras.

### Numeración canónica

| Fase | Alcance | Estado |
| ---- | ------- | ------ |
| **Fase 1** | Reservas de lecciones · PayPal / pago al llegar · panel · check-in + waiver | ✅ construido |
| **Fase 2** | Rentals de tablas — online + mostrador + hoja de vida por tabla | ✅ construido |
| **Etapa 3** *(este plan)* | **Tienda de accesorios** — POS de mostrador + escaparate con retiro en tienda | ⏳ planificación |
| **Fase 4+** | Tours · envíos · devoluciones formales · factura electrónica · analítica | futuro |

---

## 2. Qué se reusa (ya está construido)

Esta etapa se apoya casi entera en piezas existentes. Lo importante:

| Pieza | Uso en la tienda |
| ----- | ---------------- |
| **`payments.related_type`** | **ya acepta `'order'`** ([schema-bookings.sql:146](../supabase/schema-bookings.sql#L146)). El hook está puesto |
| **`cash_shift_totals`** | suma `payments` filtrando **sólo por `shift_id`**, sin mirar `related_type` ([schema-cash.sql:206-220](../supabase/schema-cash.sql#L206-L220)). Una venta de tienda con `shift_id` **entra al cierre sin tocar el módulo de caja** |
| `lib/cash.ts` | `getOpenShift()` / `expectedCash()` y el guard "no cobrás sin turno abierto", tal cual |
| `cash_expenses` · reembolsos de `CashView` | cubren el "me equivoqué" de v1 (ver §8.3) |
| `customers` | find-or-create por email para la vía online. En mostrador la venta es anónima |
| `src/lib/paypal.ts` + `payments/paypal/*` | pago online; config del panel ya funcionando |
| `CatalogGrid.tsx` + `catalog.css` | grilla pública con filtros del lado del cliente — el molde exacto |
| `lib/rental-cart.ts` | carrito en `localStorage` — mismo patrón para el carrito de tienda |
| `QrStickersView` (`window.print()` + `@media print`) | **precedente de impresión**: el recibo se resuelve igual (§6) |
| `api/cron/cleanup.ts` | limpieza de `pending_payment` abandonados — se le suman las órdenes |
| Panel staff (`StaffApp`, `FleetView`, `RentalsView`) | patrón para las vistas nuevas |

**Consecuencia de diseño:** no hay que rediseñar el cierre. La tienda se cuelga
del mismo riel que rentals y lecciones.

---

## 3. Decisiones cerradas (2026-09-09)

| # | Tema | Decisión |
| - | ---- | -------- |
| 1 | **Factura electrónica** | **Fuera de alcance.** No se maneja facturación electrónica por ahora, ni se cruzan datos con QPOS. El POS emite un **recibo impreso, no fiscal** |
| 2 | **Tienda online** | **Retirá en tienda.** Orden online, paga con PayPal o al retirar. **Sin envíos** |
| 3 | **Variantes** | **Sí.** Talla / color (rash guards, bikinis, boardshorts). Tabla `product_variants` |
| 4 | **Código de barras** | **No tienen.** Sin lector. El POS busca por nombre + grilla de productos frecuentes |
| 5 | **Recibo** | **Impreso.** Impresora térmica vía `window.print()` + CSS 80 mm |
| 6 | **Tamaño del catálogo** | **~50 productos** (con variantes, ~120-150 SKUs). Filtrado en el cliente, sin buscador en SQL |
| 7 | **Costo / margen** | **No se maneja por ahora.** La columna `cost` queda en el schema pero **sin UI** |
| 8 | **Devoluciones** | **v2.** En v1 se resuelve con el reembolso + ajuste de stock que ya existen (§8.3) |

### 3.1 Precios e IVA

Los precios se cargan y se muestran **con IVA incluido**, como se vende en el
mostrador. **El sistema no calcula desglose de impuesto**: un producto tiene un
precio y punto. El recibo dice "IVA incluido" como texto fijo.

Si más adelante entra facturación electrónica, hace falta agregar `tax_rate` y
`cabys_code` por producto y los campos de comprobante en `orders`. Son
`alter table add column`, no una migración de datos — por eso no se anticipan acá.

---

## 4. Modelo de datos — `supabase/schema-shop.sql`

Seis tablas nuevas. Mismo patrón que `board_models` / `board_units`.

### 4.1 `products` — el producto de catálogo

```
products
  id, name, slug unique,
  category ('leash'|'wax'|'fins'|'apparel'|'sunscreen'|'bags'|'accessories'),
  brand text null,
  description text null,
  image_urls text[],
  price numeric not null,          -- precio al público, IVA incluido
  cost numeric null,               -- sin UI en v1 (decisión 7)
  has_variants bool not null default false,
  active bool, featured bool, sort_order int, timestamps
-- RLS: lectura pública de activos (como class_types / board_models).
```

### 4.2 `product_variants` — talla / color

```
product_variants
  id, product_id → products (cascade),
  sku text unique,                 -- interno, generado (no hay código de barras)
  label text not null,             -- 'M', 'L / Negro', 'Único'
  price_override numeric null,     -- null = usa products.price
  active bool, sort_order int, timestamps
-- Todo producto tiene al menos UNA variante ('Único'), aunque has_variants = false.
-- Así el stock y las líneas de venta apuntan siempre a variant_id, sin ramas.
```

> **Regla clave:** el stock y `order_items` **siempre** apuntan a `variant_id`,
> nunca a `product_id`. Un producto sin variantes reales tiene una variante
> `'Único'` creada automáticamente. Evita duplicar toda la lógica.

### 4.3 `inventory` — stock físico (una sola bodega: la tienda)

```
inventory
  variant_id uuid primary key references product_variants (cascade),
  qty_on_hand int not null default 0,   -- lo que está FÍSICAMENTE en la tienda
  reorder_point int null,               -- avisa "quedan pocas"
  updated_at
```

`qty_on_hand` = lo que hay en el estante. **Disponible para vender** se calcula
(§8.1), no se guarda: evita que los dos números se desincronicen.

### 4.4 `inventory_moves` — kardex

```
inventory_moves
  id, variant_id → product_variants (restrict),
  delta int not null,              -- +entrada / −salida
  reason ('sale'|'return'|'purchase'|'adjustment'|'shrinkage'|'correction'),
  related_type text null, related_id uuid null,   -- 'order' + order_id
  note text null,
  created_by → profiles (set null), created_at
```

**Es la única vía para mover stock.** Nadie hace `update inventory set qty_on_hand`:
se inserta un movimiento y un trigger (`apply_inventory_move`) aplica el delta. Un
solo camino de escritura significa que el stock **no puede** cambiar sin dejar rastro,
y que `inventory` y el kardex nunca se desincronizan.

### 4.5 `orders` — una venta

```
orders
  id, reference ('ORD-XXXXX') unique,
  channel ('pos'|'online') not null,
  customer_id → customers (set null),   -- null = venta anónima de mostrador
  status ('pending_payment'|'reserved'|'paid'|'picked_up'|'cancelled'),
  subtotal numeric, discount_total numeric default 0, total numeric,
  currency text default 'USD',
  -- atribución (mismo criterio que rentals.reserved_by / checked_out_by)
  sold_by → profiles (set null),        -- quién vendió en mostrador (null = online)
  handed_over_by → profiles (set null), -- quién entregó una orden online
  shift_id → cash_shifts (set null),    -- turno del cobro (null = online sin cobrar)
  picked_up_at timestamptz null,
  customer_note text, staff_note text, timestamps
-- RLS: staff-only. La vía online escribe por endpoint con service_role.
```

**Estados por canal:**

```
POS       →  picked_up                             (cobrar = entregar, un solo paso)
Online    →  pending_payment  → paid → picked_up   (PayPal)
          →  reserved         → paid → picked_up   (paga al retirar)
```

| Estado | Qué significa | Stock |
| ------ | ------------- | ----- |
| `pending_payment` | online, esperando PayPal | retiene 20 min |
| `reserved` | online, paga al retirar | retiene 48 h |
| `paid` | pagada, esperando que el cliente pase | retiene sin límite |
| `picked_up` | entregada. **Terminal** | **`qty_on_hand` ya bajó** |
| `cancelled` | terminal | no retiene |

> **Una sola regla:** el stock físico baja **si y sólo si** la orden llega a
> `picked_up`. Por eso el POS crea la orden directamente en ese estado — en el
> mostrador cobrar y entregar son el mismo momento.

### 4.6 `order_items` — las líneas

```
order_items
  id, order_id → orders (cascade),
  variant_id → product_variants (restrict),
  -- snapshots: la venta no cambia si después cambia el catálogo
  name_snapshot text not null,      -- 'Leash 6" Dakine — M'
  sku_snapshot text not null,
  unit_price numeric not null,
  qty int not null check (qty > 0),
  discount numeric not null default 0,
  line_total numeric not null
```

> **Snapshots**, igual que `rentals.unit_price`. Si mañana sube el precio del wax,
> el recibo de ayer no puede cambiar.

### 4.7 Pagos — sin `payment_id` en la orden

A diferencia de `rentals` / `bookings`, **`orders` NO lleva un `payment_id` único**.
Los pagos se cuelgan de `payments.related_id` con `related_type = 'order'`.

Eso da **split tender gratis**: paga $20 en efectivo y $15 con tarjeta = dos filas
en `payments`, ambas con `shift_id` y `collected_by`, ambas entrando al cierre por
su método. Lo pagado de una orden es `sum(payments where related_id = order.id and status = 'paid')`.

---

## 5. POS de mostrador

Es la pieza que reemplaza la digitación en QPOS. El criterio es **velocidad**: con
50 productos y sin lector, todo tiene que estar a uno o dos toques.

```
┌──────────────────────────────┬─────────────────────┐
│  [ buscar producto…      ]   │  ORDEN              │
│                              │  ─────────────────  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ │  Wax tropical   ×2  │
│  │Wax │ │Leash│ │Sun │ │Rash│ │  Leash 6'       ×1  │
│  └────┘ └────┘ └────┘ └────┘ │  ─────────────────  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ │  Total    $37.00    │
│  │Fins│ │Bag │ │Hat │ │Bikini│ │                    │
│  └────┘ └────┘ └────┘ └────┘ │  [ Cobrar ]         │
└──────────────────────────────┴─────────────────────┘
```

- **Grilla de productos** con foto, nombre y precio. Filtro por categoría + búsqueda
  incremental. Los `featured` primero (wax, leash, bloqueador: lo que más rota).
- **Producto con variantes** → al tocarlo abre un selector chico de talla/color.
  Muestra el stock de cada variante y **deshabilita las que están en 0**.
- **Carrito**: cantidad ±, descuento por línea (opcional), quitar.
- **Cobro**: chips `Efectivo` / `Tarjeta` / `Dividido`.
  - Efectivo con **calculadora de vuelto**: "Recibí [50.00] → Vuelto **$13.00**".
  - Dividido: dos montos que deben sumar el total.
- **Guard de turno**: mismo criterio que rentals — si no hay turno abierto, el botón
  de cobrar está bloqueado con el mensaje que apunta a *Cash → Cash Close*.
- Al confirmar: crea `orders` + `order_items`, inserta los `payments` con
  `collected_by` + `shift_id`, descuenta stock (`inventory_moves` reason `'sale'`),
  y **abre el recibo para imprimir**.

---

## 6. Recibo impreso

**Sin driver especial ni agente**: se resuelve como los stickers QR, con
`window.print()` y una hoja CSS a 80 mm. La impresora térmica se instala en el
sistema operativo de la tablet/PC del mostrador y se elige como impresora por defecto.

```css
@page { size: 80mm auto; margin: 0; }
@media print {
  body * { visibility: hidden; }
  .receipt, .receipt * { visibility: visible; }
  .receipt { position: absolute; inset: 0; width: 80mm; font-size: 11px; }
}
```

Contenido del recibo:

```
        MORE SURF SHOP
     Tamarindo, Guanacaste
   ─────────────────────────
   ORD-4KP2M      09/09/2026
   Atendió: Luis        14:32
   ─────────────────────────
   2× Wax tropical      12.00
   1× Leash 6'          25.00
   ─────────────────────────
   TOTAL              $37.00
   Efectivo  $50.00
   Vuelto    $13.00
   IVA incluido
   ─────────────────────────
    ¡Gracias! · Cambios con
      recibo dentro de 8 días
```

**No es comprobante fiscal** — es el comprobante de la tienda para el cliente
(cambios, garantía, referencia de la orden).

---

## 7. Tienda pública

### 7.1 Rutas

```
/surf-shop-tamarindo                    hero + categorías + catálogo + FAQ   [index]
/surf-shop-tamarindo/[category]         catálogo pre-filtrado                [index]
/surf-shop-tamarindo/[slug]             ficha del producto                   [index]
/reserva-tienda                          carrito + datos + confirmación       [noindex]
```

Hoy `/surf-shop-tamarindo` es un "Coming soon" con CTA de WhatsApp
([surf-shop-tamarindo.astro](../src/pages/surf-shop-tamarindo.astro)). Se convierte
en el hub real. El catálogo se renderiza en el server (SEO) y una isla React filtra
en el cliente — con 50 productos no hace falta filtrar en SQL, igual que en rentals.

### 7.2 Flujo online — retirá en tienda

```
Catálogo → ficha → elegir variante → agregar al carrito
        → carrito → datos de contacto
        → PayPal  (status 'pending_payment' → 'paid')
        o "Pago al retirar"  (status 'reserved')
        → email de confirmación con el código ORD-XXXXX
        → el cliente pasa por la tienda
        → el staff busca la orden, entrega, cobra si hace falta → 'picked_up'
```

- **Sin envíos.** El copy tiene que ser explícito: *"Reservá online, retirá en la
  tienda en Tamarindo"*, con dirección y horario.
- **Ventana de retiro:** la orden `reserved` (sin pagar) retiene stock **48 h**;
  después el cron la cancela y libera. La `pending_payment` de PayPal retiene
  20 min, igual que rentals (`PENDING_HOLD_MINUTES`).
- El cobro al retirar entra al cierre del empleado que entrega, con
  `handed_over_by` + `shift_id`.

### 7.3 API

- `GET /api/shop/products` — catálogo con disponibilidad calculada.
- `POST /api/shop/orders` — crea la orden online. Revalida precio y stock **en el
  server** (no confía en el cliente), find-or-create customer.
- `POST /api/shop/pos-sale` — venta de mostrador: crea orden + líneas + pagos +
  movimientos de stock **en una sola llamada**, con guard de turno abierto.
- `POST /api/shop/pickup` — marca `picked_up`, cobra si estaba `reserved`.
- **PayPal**: `create-order` / `capture` hoy leen `booking_groups`. Se les agrega
  un discriminador para aceptar también `order_id`. `orders` no se mete en
  `booking_groups` — son formas distintas (líneas con impuesto y stock).

---

## 8. Inventario

### 8.1 Disponible ≠ stock físico

```
disponible(variant) = qty_on_hand
                    − Σ qty de órdenes 'pending_payment' vivas (holds de 20 min)
                    − Σ qty de órdenes 'reserved' o 'paid' aún NO retiradas
```

Se calcula con `shop_variant_available(variant_id)`, una función `security definer`
igual que `is_unit_available` en rentals. **No se guarda un contador de reservado**
para que no se desincronice. El catálogo público la sirve por `list_shop_catalog()`.

`qty_on_hand` baja **si y sólo si** la orden llega a `picked_up` (§4.5): en el POS
eso es el momento del cobro; online, cuando el cliente pasa a retirar.

**Stock negativo se permite a propósito.** No hay `check qty_on_hand >= 0`: si el
stock queda negativo es señal de que falta un ajuste, y bloquear una venta en el
mostrador es peor que registrarla. La vista Inventory lo marca en rojo.

### 8.2 Entradas y ajustes

Todo pasa por `inventory_moves` — nunca por un `update` directo:

- **Compra / reposición**: "entró mercadería" → `+delta`, reason `'purchase'`.
- **Ajuste manual**: `+/− delta` con **motivo obligatorio**, reason `'adjustment'`.
- La toma de inventario formal (contar todo y cuadrar) queda para v2.

### 8.3 El "me equivoqué" de v1 (sin flujo de devoluciones)

Devoluciones formales son v2 (decisión 8). En v1, un error de cobro se resuelve con
lo que **ya existe**:

1. **Reembolso** desde `CashView` → `/api/payments/refund-counter` con la referencia
   `ORD-…`. Queda atribuido al turno y resta del efectivo esperado.
2. **Ajuste de stock** manual con reason `'correction'` y nota.

No es elegante, pero no requiere código nuevo y deja rastro en los dos lados.

---

## 9. Integración con el cierre de caja

**No se toca nada del módulo de caja.** El mecanismo:

```
POS cobra  →  payments {
                provider: 'cash' | 'card',
                status: 'paid',
                related_type: 'order',
                related_id: <order.id>,
                collected_by: <staff>,
                shift_id: <turno abierto>
              }
              ↓
   cash_shift_totals(shift_id)  ya lo suma  →  CashView lo muestra
```

Lo único que conviene agregar es **visibilidad**: que `CashView` desglose el turno
por origen (lecciones / rentals / tienda) en vez de un solo total. Es un cambio
cosmético en la RPC (agregar un `group by related_type`), no estructural.

---

## 10. Panel de staff — vistas nuevas

Sección **Shop** en el sidebar de `StaffApp`:

- **Sell** — el POS (§5). Es la vista por defecto de la sección.
- **Products** — CRUD de productos y variantes: nombre, categoría, precio, fotos,
  activo/destacado. Mismo patrón que `FleetView` (modelos + unidades).
- **Inventory** — stock por variante, entradas, ajustes, alerta de `reorder_point`,
  y el kardex (`inventory_moves`) por producto.
- **Orders** — órdenes online pendientes de retiro (la cola del mostrador) +
  historial de ventas con filtro por día/empleado.

---

## 11. Orden de construcción

| # | Paso | Entrega |
| - | ---- | ------- |
| **S1** | ✅ **Schema** `schema-shop.sql`: las 6 tablas + RLS + triggers (kardex, variante `'Único'`, fila de stock) + `shop_variant_available()` / `list_shop_catalog()` / `shop_low_stock()` + tipos en `supabase.ts`. **Falta correrlo en Supabase** | base |
| **S2** | **Panel — Products + Inventory**: CRUD, carga de las ~50 fichas, stock inicial | el dueño ya puede cargar el catálogo |
| **S3** | **POS de mostrador** + recibo impreso + `payments` con `shift_id` → **entra al cierre solo** | **acá se retira QPOS del día a día** |
| **S4** | **Escaparate público**: hub + categorías + fichas, SEO, sin checkout | valor SEO inmediato |
| **S5** | **Checkout online "retirá en tienda"**: carrito, PayPal / pago al retirar, cola de retiro en el panel, cron de expiración | cierra la etapa |

**S1 + S2 + S3 es el corazón.** Con eso el mostrador deja QPOS y el cierre queda
unificado con lecciones y rentals, aunque la parte pública tarde. Mismo criterio
que usamos en Etapa 2.

---

## 12. Pendientes y riesgos

### Pendientes de datos (no bloquean empezar)

- **Lista real de los ~50 productos** con categoría, precio y qué lleva variantes.
- **Fotos** de producto (la calidad define si el escaparate sirve o no).
- **Stock inicial** por variante.
- **Modelo de impresora térmica** — confirmar que instala driver en la tablet/PC
  del mostrador (si es sólo Bluetooth ESC/POS sin driver, hay que replantear §6).
- Texto de política de cambios para el pie del recibo.

### Riesgos conocidos

| Riesgo | Mitigación |
| ------ | ---------- |
| **Oversell online/mostrador** | Casi nulo con "retirá en tienda" + holds. `shop_availability()` calculado, sin contador que se desincronice |
| **Sin lector de barras** | Con 50 productos la grilla + búsqueda alcanza. Si crece, se agrega `@zxing/browser` o lector USB (emula teclado) |
| **Devoluciones sin flujo propio** | v1 usa reembolso + ajuste (§8.3). Formalizar en v2 |
| **Si más adelante entra factura electrónica** | `alter table` para agregar `tax_rate` / `cabys_code` a `products` y campos de comprobante a `orders`. Los precios ya son IVA incluido, así que no hay migración de datos (§3.1) |
