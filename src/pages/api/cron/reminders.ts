import type { APIRoute } from 'astro';
import { cronAuthorized } from '@lib/cron';
import { notifyOverdueRentals, sendDueReminders, sendDueRentalReminders } from '@lib/email';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  if (!cronAuthorized(request, url)) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const [lessons, rentalPickups, rentalsOverdue] = await Promise.all([
      sendDueReminders(),
      sendDueRentalReminders(),
      notifyOverdueRentals(),
    ]);
    return new Response(
      JSON.stringify({
        ok: true,
        lessons: lessons.processed,
        rentalPickups: rentalPickups.processed,
        rentalsOverdue: rentalsOverdue.processed,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[cron/reminders]', e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};
