import { useEffect, useState } from 'react';

/**
 * Carga el SDK JS de PayPal una sola vez y expone su estado.
 * No importa nada del server: solo usa window.paypal.
 */

type SdkStatus = 'idle' | 'loading' | 'ready' | 'error';

let sdkPromise: Promise<void> | null = null;

function loadSdk(clientId: string, currency: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).paypal) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId,
      currency,
      intent: 'capture',
      components: 'buttons',
      'disable-funding': 'paylater,credit',
    });
    s.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('PayPal SDK failed to load'));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function usePayPalSdk(clientId: string, currency = 'USD'): SdkStatus {
  const [status, setStatus] = useState<SdkStatus>(clientId ? 'loading' : 'idle');

  useEffect(() => {
    if (!clientId) {
      setStatus('idle');
      return;
    }
    let alive = true;
    setStatus((window as any).paypal ? 'ready' : 'loading');
    loadSdk(clientId, currency)
      .then(() => alive && setStatus('ready'))
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, [clientId, currency]);

  return status;
}
