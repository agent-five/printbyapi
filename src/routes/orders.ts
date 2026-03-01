import { Hono } from 'hono';
import { supabase } from '../lib/db.js';
import { dispatchWebhook } from '../lib/webhooks.js';
import { createPaymentIntent } from '../lib/stripe.js';
import type { Env } from '../types/index.js';

const orders = new Hono<Env>();

function formatId(uuid: string, prefix: string): string {
  return prefix + '_' + uuid.replace(/-/g, '').slice(-8);
}

orders.post('/', async (c) => {
  const accountId = c.get('account_id');
  const body = await c.req.json<{
    quote_id: string;
    idempotency_key?: string;
  }>();

  if (!body.quote_id) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'quote_id is required',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Check idempotency key — return existing order if duplicate
  if (body.idempotency_key) {
    const { data: existing } = await supabase
      .from('orders')
      .select('*')
      .eq('idempotency_key', body.idempotency_key)
      .eq('account_id', accountId)
      .single();

    if (existing) {
      // Verify it matches the same quote
      if (existing.quote_id !== body.quote_id) {
        return c.json(
          {
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'Idempotency key already used with a different quote_id',
              request_id: c.get('request_id'),
            },
          },
          409
        );
      }

      return c.json({
        order_id: formatId(existing.id, 'order'),
        status: existing.status,
        created_at: existing.created_at,
        estimated_ship_date: estimateShipDate(existing.created_at, 5),
      });
    }
  }

  // Look up quote
  const { data: quote } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', body.quote_id)
    .eq('account_id', accountId)
    .single();

  if (!quote) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Quote not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  // Check expiration
  if (new Date(quote.expires_at) < new Date()) {
    return c.json(
      {
        error: {
          code: 'QUOTE_EXPIRED',
          message: `This quote expired at ${quote.expires_at}`,
          request_id: c.get('request_id'),
        },
      },
      410
    );
  }

  // TODO: Create Stripe payment intent
  const paymentIntentId = await createPaymentIntent(
    Number(quote.total_usd),
    accountId
  );

  // Create order
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      account_id: accountId,
      quote_id: quote.id,
      idempotency_key: body.idempotency_key || null,
      status: 'confirmed',
      stripe_payment_intent_id: paymentIntentId,
    })
    .select()
    .single();

  if (error) {
    console.error('[orders] insert error:', error);
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Failed to create order',
          request_id: c.get('request_id'),
        },
      },
      500
    );
  }

  // Add order event
  await supabase.from('order_events').insert({
    order_id: order.id,
    status: 'confirmed',
    note: 'Order created',
  });

  // Dispatch webhook (non-blocking)
  dispatchWebhook(accountId, {
    event: 'order.confirmed',
    order_id: formatId(order.id, 'order'),
    status: 'confirmed',
    timestamp: new Date().toISOString(),
  });

  return c.json(
    {
      order_id: formatId(order.id, 'order'),
      status: order.status,
      created_at: order.created_at,
      estimated_ship_date: estimateShipDate(order.created_at, quote.estimated_days),
    },
    201
  );
});

orders.get('/:id', async (c) => {
  const accountId = c.get('account_id');
  const orderId = c.req.param('id');

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single();

  if (!order) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Order not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  // Fetch events
  const { data: events } = await supabase
    .from('order_events')
    .select('status, note, created_at')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });

  return c.json({
    order_id: formatId(order.id, 'order'),
    status: order.status,
    tracking_number: order.tracking_number,
    tracking_url: order.tracking_url,
    created_at: order.created_at,
    updated_at: order.updated_at,
    events: events || [],
  });
});

orders.get('/', async (c) => {
  const accountId = c.get('account_id');
  const limit = Math.min(Number(c.req.query('limit') || 20), 100);
  const cursor = c.req.query('cursor');
  const status = c.req.query('status');

  let query = supabase
    .from('orders')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit + 1); // Fetch one extra to determine if there's a next page

  if (cursor) {
    // Cursor-based pagination: fetch orders created before the cursor order
    const { data: cursorOrder } = await supabase
      .from('orders')
      .select('created_at')
      .eq('id', cursor)
      .single();

    if (cursorOrder) {
      query = query.lt('created_at', cursorOrder.created_at);
    }
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data: orderRows } = await query;
  const rows = orderRows || [];

  const hasMore = rows.length > limit;
  const results = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    orders: results.map((o) => ({
      order_id: formatId(o.id, 'order'),
      status: o.status,
      tracking_number: o.tracking_number,
      tracking_url: o.tracking_url,
      created_at: o.created_at,
      updated_at: o.updated_at,
    })),
    next_cursor: hasMore ? results[results.length - 1].id : null,
  });
});

function estimateShipDate(createdAt: string, days: number): string {
  const date = new Date(createdAt);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

export default orders;
