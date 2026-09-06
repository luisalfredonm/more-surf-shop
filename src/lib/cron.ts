/**
 * Auth para endpoints de cron. Acepta:
 *   - Header `Authorization: Bearer <CRON_SECRET>`  (lo manda Vercel Cron)
 *   - `?token=<CRON_SECRET>`                        (para probar a mano)
 */
export function cronAuthorized(request: Request, url: URL): boolean {
  const secret = import.meta.env.CRON_SECRET ?? '';
  if (!secret) return false;
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  return url.searchParams.get('token') === secret;
}
