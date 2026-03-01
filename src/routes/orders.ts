import { Hono } from 'hono';
import { supabase } from '../lib/db.js';
import { dispatchWebhook } from '../lib/webhooks.js';
import { getOrCreateCustomer, chargeOrder, refundOrder } from '../lib/stripe.js';
import { formatId, resolveQuoteId, resolveOrderId } from '../lib/ids.js';
import type { Env } from '../types/index.js';

const orders = new Hono<Env>();

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

  // Resolve quote_id (accept display ID or full UUID)
  const quoteId = await resolveQuoteId(body.quote_id, accountId);
  if (!quoteId) {
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
      if (existing.quote_id !== quoteId) {
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
    .eq('id', quoteId)
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

  // Check for a default payment method
  const { data: defaultPm } = await supabase
    .from('payment_methods')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_default', true)
    .single();

  if (!defaultPm) {
    return c.json(
      {
        error: {
          code: 'NO_PAYMENT_METHOD',
          message: 'Add a payment method before placing orders',
          request_id: c.get('request_id'),
        },
      },
      402
    );
  }

  // Get account email for Stripe customer lookup
  const { data: account } = await supabase
    .from('accounts')
    .select('email')
    .eq('id', accountId)
    .single();

  // Get or create Stripe customer
  const customerId = await getOrCreateCustomer(accountId, account!.email);

  // Charge via PaymentIntent
  const amountCents = Math.round(Number(quote.total_usd) * 100);
  let paymentIntent;
  try {
    paymentIntent = await chargeOrder(customerId, amountCents, quoteId, {
      account_id: accountId,
      quote_id: quoteId,
    });
  } catch (err: any) {
    const message = err?.message || 'Payment failed';
    return c.json(
      {
        error: {
          code: 'PAYMENT_FAILED',
          message,
          request_id: c.get('request_id'),
        },
      },
      402
    );
  }

  // Create order
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      account_id: accountId,
      quote_id: quote.id,
      idempotency_key: body.idempotency_key || null,
      status: 'confirmed',
      stripe_payment_intent_id: paymentIntent.id,
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

// POST /v1/orders/:id/refund — admin-only refund
orders.post('/:id/refund', async (c) => {
  // Admin auth: check for ADMIN_API_KEY
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey || apiKey !== adminKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
          request_id: c.get('request_id'),
        },
      },
      403
    );
  }

  const orderId = await resolveOrderId(c.req.param('id'));

  if (!orderId) {
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

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
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

  if (!order.stripe_payment_intent_id) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Order has no payment intent to refund',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  try {
    await refundOrder(order.stripe_payment_intent_id);
  } catch (err: any) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: err?.message || 'Refund failed',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Update order status to cancelled
  await supabase
    .from('orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  // Add order event
  await supabase.from('order_events').insert({
    order_id: orderId,
    status: 'cancelled',
    note: 'Order refunded',
  });

  return c.json({
    order_id: formatId(orderId, 'order'),
    status: 'cancelled',
    refunded: true,
  });
});

orders.get('/:id', async (c) => {
  const accountId = c.get('account_id');
  const orderId = await resolveOrderId(c.req.param('id'), accountId);

  if (!orderId) {
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
