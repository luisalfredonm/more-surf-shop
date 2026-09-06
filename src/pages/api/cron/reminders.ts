import type { APIRoute } from 'astro';
import { cronAuthorized } from '@lib/cron';
import { sendDueReminders } from '@lib/email';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  if (!cronAuthorized(request, url)) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const res = await sendDueReminders();
    return new Response(JSON.stringify({ ok: true, ...res }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[cron/reminders]', e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};
