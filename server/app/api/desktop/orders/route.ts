import { db } from '@/lib/crm/server';
import { validDesktopAccess } from '@/lib/crm/desktop-access.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'no-store, private',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};
export async function GET(request: Request) {
  if (!validDesktopAccess(request.headers.get('authorization'), process.env.DESKTOP_ORDERS_TOKEN_HASH))
    return Response.json({ error: 'Доступ приложения не подтверждён.' }, { status: 401, headers });
  try {
    const result = await db().prepare(
      'SELECT id,request_id,order_group,product,name,phone,quantity,amount,size,finish,deadline,city,stage,created_at,updated_at FROM crm_leads ORDER BY created_at DESC,id DESC LIMIT 10000',
    ).all();
    return Response.json({ orders: result.results }, { headers });
  } catch {
    return Response.json({ error: 'Сайт временно недоступен. Попробуйте позже.' }, { status: 503, headers });
  }
}
