import { useEffect, useRef, useState } from 'react';
import { usePayPalSdk } from '../booking/usePayPal';
import {
  clearShopCart,
  readShopCart,
  removeFromShopCart,
  setShopCartQty,
  type ShopCartItem,
} from '@lib/shop-cart';
import './shop.css';

/**
 * Checkout de la tienda: "retirá en tienda". Sin envíos.
 *
 * El precio que se ve acá es informativo: /api/shop/orders recalcula todo
 * contra la base y valida stock antes de crear la orden. Si algo cambió, el
 * server manda el error y el carrito se corrige.
 */

const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n));

type Method = 'paypal' | 'on_pickup';

interface Created {
  order_id: string;
  reference: string;
  total: number;
  method: Method;
}

export default function ShopCheckout({
  paypalClientId,
  whatsappNumber,
}: {
  paypalClientId: string;
  whatsappNumber: string;
}) {
  const paypalEnabled = paypalClientId.length > 0;

  const [items, setItems] = useState<ShopCartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [contact, setContact] = useState({ full_name: '', email: '', phone: '' });
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [method, setMethod] = useState<Method>(paypalEnabled ? 'paypal' : 'on_pickup');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    setItems(readShopCart());
    setHydrated(true);
  }, []);

  const total = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim());
  const valid = items.length > 0 && contact.full_name.trim().length >= 2 && emailOk;

  function setQty(variantId: string, qty: number) {
    setItems(setShopCartQty(variantId, qty));
    setErr(null);
  }
  function drop(variantId: string) {
    setItems(removeFromShopCart(variantId));
    setErr(null);
  }

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ variant_id: i.variant_id, qty: i.qty })),
          contact: {
            full_name: contact.full_name.trim(),
            email: contact.email.trim(),
            phone: contact.phone.trim() || null,
          },
          payment_method: method,
          customer_note: note.trim() || null,
          website,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 201 || !data.ok) {
        // Si el stock cambió mientras miraba, se ajusta la línea afectada.
        if (data.code === 'not_enough_stock' && data.variant_id) {
          setItems(
            Number(data.available) > 0
              ? setShopCartQty(data.variant_id, Number(data.available))
              : removeFromShopCart(data.variant_id),
          );
        }
        setErr(data.error || "We couldn't create your order.");
        setBusy(false);
        return;
      }
      setCreated({
        order_id: data.order_id,
        reference: data.reference,
        total: Number(data.total),
        method,
      });
      if (method === 'on_pickup') {
        clearShopCart();
        setItems([]);
      }
      setBusy(false);
    } catch {
      setErr('Connection failed. Try again.');
      setBusy(false);
    }
  }

  const waHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    created ? `Hi! About my order ${created.reference}.` : 'Hi! A question about the shop.',
  )}`;

  // --- Confirmación ---
  if (created && (created.method === 'on_pickup' || paid)) {
    return (
      <div className="sh-done">
        <h1>{paid ? "You're paid up" : 'Your order is reserved'}</h1>
        <p className="sh-done-ref">{created.reference}</p>
        <p>
          {paid
            ? `We charged ${money(created.total)}. Come by the shop and show this code.`
            : `Pay ${money(created.total)} when you pick it up. We hold it for 48 hours.`}
        </p>
        <p className="sh-buy-note">
          We're on Playa Tamarindo, open every day. Bring the code or just your name.
        </p>
        <p style={{ marginTop: '1.5rem' }}>
          <a className="sh-add" style={{ display: 'inline-block', textDecoration: 'none' }} href={waHref} target="_blank" rel="noopener noreferrer">
            Message us on WhatsApp
          </a>
        </p>
        <p style={{ marginTop: '1rem' }}>
          <a href="/surf-shop-tamarindo">← Back to the shop</a>
        </p>
      </div>
    );
  }

  // --- Pago con PayPal (la orden ya existe, en pending_payment) ---
  if (created && created.method === 'paypal') {
    return (
      <div className="sh-done">
        <h1>Almost there</h1>
        <p className="sh-done-ref">{created.reference}</p>
        <p>Pay {money(created.total)} to lock it in. We'll have it ready at the shop.</p>
        {err && <div className="sh-co-err" style={{ marginTop: '1rem' }}>{err}</div>}
        <div style={{ maxWidth: '22rem', margin: '1.5rem auto 0' }}>
          <PayPalBox
            clientId={paypalClientId}
            shopOrderId={created.order_id}
            onPaid={() => {
              clearShopCart();
              setItems([]);
              setPaid(true);
            }}
            onFail={setErr}
          />
        </div>
        <p className="sh-buy-note">
          Trouble paying? <a href={waHref} target="_blank" rel="noopener noreferrer">Message us</a> and
          we'll hold it for you.
        </p>
      </div>
    );
  }

  if (!hydrated) return null;

  if (items.length === 0) {
    return (
      <div className="sh-done">
        <h1>Your order is empty</h1>
        <p className="sh-buy-note">Add something from the shop and come back.</p>
        <p style={{ marginTop: '1.5rem' }}>
          <a className="sh-add" style={{ display: 'inline-block', textDecoration: 'none' }} href="/surf-shop-tamarindo">
            Browse the shop
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="sh-co">
      <div>
        <h1>Your order</h1>
        {items.map((i) => (
          <div className="sh-co-line" key={i.variant_id}>
            <div className="sh-co-thumb">
              {i.image ? <img src={i.image} alt="" /> : null}
            </div>
            <div>
              <div className="sh-co-name">
                <a href={`/surf-shop-tamarindo/product/${i.product_slug}`}>{i.name}</a>
              </div>
              <div className="sh-co-sub">
                {i.label !== 'Único' ? `${i.label} · ` : ''}
                {money(i.price)} each
              </div>
              <div className="sh-qty" style={{ marginTop: '0.4rem', width: 'fit-content' }}>
                <button
                  type="button"
                  onClick={() => setQty(i.variant_id, i.qty - 1)}
                  disabled={i.qty <= 1}
                  aria-label="One less"
                >
                  −
                </button>
                <span>{i.qty}</span>
                <button
                  type="button"
                  onClick={() => setQty(i.variant_id, i.qty + 1)}
                  aria-label="One more"
                >
                  +
                </button>
              </div>
            </div>
            <div className="sh-co-right">
              <div className="sh-co-price">{money(i.price * i.qty)}</div>
              <button className="sh-co-remove" type="button" onClick={() => drop(i.variant_id)}>
                Remove
              </button>
            </div>
          </div>
        ))}

        <div className="sh-co-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
        <p className="sh-buy-note">
          Tax included. Pick up at our shop on Playa Tamarindo — we don't ship.
        </p>
      </div>

      <div className="sh-co-panel">
        {err && <div className="sh-co-err">{err}</div>}

        <div className="sh-co-field">
          <label htmlFor="co-name">Your name *</label>
          <input
            id="co-name"
            value={contact.full_name}
            onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
            autoComplete="name"
          />
        </div>
        <div className="sh-co-field">
          <label htmlFor="co-email">Email *</label>
          <input
            id="co-email"
            type="email"
            inputMode="email"
            value={contact.email}
            onChange={(e) => setContact({ ...contact, email: e.target.value })}
            autoComplete="email"
          />
        </div>
        <div className="sh-co-field">
          <label htmlFor="co-phone">Phone / WhatsApp</label>
          <input
            id="co-phone"
            type="tel"
            inputMode="tel"
            value={contact.phone}
            onChange={(e) => setContact({ ...contact, phone: e.target.value })}
            autoComplete="tel"
          />
        </div>
        <div className="sh-co-field">
          <label htmlFor="co-note">Anything we should know?</label>
          <textarea
            id="co-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="sh-hp" aria-hidden="true">
          <label htmlFor="co-website">Website</label>
          <input
            id="co-website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {paypalEnabled && (
          <label className={`sh-pay-opt ${method === 'paypal' ? 'on' : ''}`}>
            <input
              type="radio"
              name="shop-pay"
              checked={method === 'paypal'}
              onChange={() => setMethod('paypal')}
            />
            <span>
              <strong>Pay now</strong>
              <br />
              <span>Card or PayPal. We set it aside for you right away.</span>
            </span>
          </label>
        )}
        <label className={`sh-pay-opt ${method === 'on_pickup' ? 'on' : ''}`}>
          <input
            type="radio"
            name="shop-pay"
            checked={method === 'on_pickup'}
            onChange={() => setMethod('on_pickup')}
          />
          <span>
            <strong>Pay when I pick it up</strong>
            <br />
            <span>We hold it at the shop for 48 hours.</span>
          </span>
        </label>

        <button className="sh-co-btn" type="button" disabled={!valid || busy} onClick={submit}>
          {busy
            ? 'Working…'
            : method === 'paypal'
              ? `Continue to payment · ${money(total)}`
              : `Reserve · ${money(total)}`}
        </button>
        {!valid && !busy && (
          <p className="sh-buy-note">Add your name and a valid email to continue.</p>
        )}
      </div>
    </div>
  );
}

function PayPalBox({
  clientId,
  shopOrderId,
  onPaid,
  onFail,
}: {
  clientId: string;
  shopOrderId: string;
  onPaid: () => void;
  onFail: (m: string) => void;
}) {
  const status = usePayPalSdk(clientId);
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || rendered.current || !ref.current) return;
    const paypal = (window as { paypal?: any }).paypal;
    if (!paypal) return;
    rendered.current = true;
    paypal
      .Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
        createOrder: async () => {
          const res = await fetch('/api/payments/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop_order_id: shopOrderId }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok || !d.id) throw new Error(d.error || 'create-order failed');
          return d.id;
        },
        onApprove: async (data: { orderID: string }) => {
          const res = await fetch('/api/payments/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: data.orderID, shop_order_id: shopOrderId }),
          });
          const d = await res.json().catch(() => ({}));
          if (res.ok && d.ok) onPaid();
          else onFail(d.error || "We couldn't confirm the payment. Message us on WhatsApp.");
        },
        onError: () => onFail('PayPal had a problem. Try again.'),
        onCancel: () => onFail('Payment cancelled. You can try again.'),
      })
      .render(ref.current)
      .catch(() => onFail("Couldn't load PayPal."));
  }, [status, shopOrderId, onPaid, onFail]);

  if (status === 'error') {
    return <p className="sh-buy-note">Online payment isn't available right now.</p>;
  }
  return <div ref={ref} />;
}
