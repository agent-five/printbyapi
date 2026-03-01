import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { randomUUID } from 'crypto';
import { auth } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import files from './routes/files.js';
import quotes from './routes/quotes.js';
import orders from './routes/orders.js';
import webhooks from './routes/webhooks.js';
import keys from './routes/keys.js';
import paymentMethods, { paymentMethodCallbacks } from './routes/payment-methods.js';
import type { Env } from './types/index.js';

const app = new Hono<Env>();

// Request ID middleware — runs on every request
app.use('*', async (c, next) => {
  const requestId = 'req_' + randomUUID().replace(/-/g, '').slice(0, 12);
  c.set('request_id', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

// Health check (no auth required)
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Unauthenticated payment method callbacks (Stripe Checkout redirects)
// Must be mounted BEFORE auth middleware
app.route('/v1/payment-methods', paymentMethodCallbacks);

// All /v1 routes require auth + rate limiting
const v1 = new Hono<Env>();
v1.use('*', auth);
v1.use('*', rateLimit);

v1.route('/files', files);
v1.route('/quotes', quotes);
v1.route('/orders', orders);
v1.route('/webhooks', webhooks);
v1.route('/keys', keys);
v1.route('/payment-methods', paymentMethods);

app.route('/v1', v1);

// 404 catch-all
app.notFound((c) =>
  c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${c.req.method} ${c.req.path}`,
        request_id: c.get('request_id'),
      },
    },
    404
  )
);

// Global error handler
app.onError((err, c) => {
  console.error('[error]', err);
  return c.json(
    {
      error: {
        code: 'INVALID_REQUEST',
        message: err.message || 'Internal server error',
        request_id: c.get('request_id'),
      },
    },
    500
  );
});

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, () => {
  console.log(`PrintByAPI running on http://localhost:${port}`);
});

export default app;
