/**
 * Rate limit en memoria (ventana deslizante por clave).
 * OJO: en Vercel serverless es por instancia y se reinicia en cold start.
 * No es una defensa fuerte — sube la barra contra abuso casual. Para algo
 * serio: KV/Upstash. Cero dependencias a propósito.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }
  return true;
}

export function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : request.headers.get('x-real-ip')) || 'unknown';
}

export function tooMany(): Response {
  return new Response(JSON.stringify({ error: 'Demasiadas solicitudes. Probá en un minuto.', code: 'rate_limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  });
}
