import { Hono } from 'hono';
import { supabase } from '../lib/db.js';
import {
  getOrCreateCustomer,
  createCheckoutSession,
  retrieveCheckoutSession,
  retrieveSetupIntent,
  retrievePaymentMethod,
  detachPaymentMethod,
} from '../lib/stripe.js';
import type { Env } from '../types/index.js';

const paymentMethods = new Hono<Env>();

// POST /v1/payment-methods/setup — create a Checkout Session for saving a card
paymentMethods.post('/setup', async (c) => {
  const accountId = c.get('account_id');

  // Get account email
  const { data: account } = await supabase
    .from('accounts')
    .select('email')
    .eq('id', accountId)
    .single();

  if (!account) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Account not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  const customerId = await getOrCreateCustomer(accountId, account.email);
  const { url, id } = await createCheckoutSession(customerId, accountId);

  return c.json({
    checkout_url: url,
    session_id: id,
  });
});

// GET /v1/payment-methods — list payment methods on the account
paymentMethods.get('/', async (c) => {
  const accountId = c.get('account_id');

  const { data: methods } = await supabase
    .from('payment_methods')
    .select('id, stripe_payment_method_id, last4, brand, exp_month, exp_year, is_default, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  return c.json({
    payment_methods: methods || [],
  });
});

// DELETE /v1/payment-methods/:id — detach from Stripe and remove from DB
paymentMethods.delete('/:id', async (c) => {
  const accountId = c.get('account_id');
  const id = c.req.param('id');

  // Find the payment method in our DB
  const { data: pm } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .single();

  if (!pm) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Payment method not found',
          request_id: c.get('request_id'),
        },
      },
      404
    );
  }

  // Detach from Stripe
  try {
    await detachPaymentMethod(pm.stripe_payment_method_id);
  } catch (err) {
    // If it's already detached in Stripe, continue with DB cleanup
    console.warn('[payment-methods] Stripe detach warning:', err);
  }

  // Remove from DB
  await supabase.from('payment_methods').delete().eq('id', id);

  return c.body(null, 204);
});

export default paymentMethods;

/**
 * Unauthenticated callback routes for Stripe Checkout redirects.
 * These must be mounted BEFORE auth middleware.
 */
export const paymentMethodCallbacks = new Hono<Env>();

// GET /v1/payment-methods/complete — Stripe redirect after successful card setup
paymentMethodCallbacks.get('/complete', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) {
    return c.html('<html><body><h1>Error</h1><p>Missing session_id.</p></body></html>', 400);
  }

  // Retrieve the Checkout Session
  const session = await retrieveCheckoutSession(sessionId);

  // Get the payment method from the SetupIntent
  const setupIntentId = typeof session.setup_intent === 'string'
    ? session.setup_intent
    : session.setup_intent?.id;

  if (!setupIntentId) {
    return c.html('<html><body><h1>Error</h1><p>No setup intent found on session.</p></body></html>', 400);
  }

  // Retrieve the SetupIntent to get the payment method
  const setupIntent = await retrieveSetupIntent(setupIntentId);

  const paymentMethodId = typeof setupIntent.payment_method === 'string'
    ? setupIntent.payment_method
    : setupIntent.payment_method?.id;

  if (!paymentMethodId) {
    return c.html('<html><body><h1>Error</h1><p>No payment method found.</p></body></html>', 400);
  }

  // Retrieve card details
  const pm = await retrievePaymentMethod(paymentMethodId);
  const card = pm.card;

  // Look up account_id from session metadata
  const accountId = session.metadata?.account_id;
  if (!accountId) {
    return c.html('<html><body><h1>Error</h1><p>Missing account information.</p></body></html>', 400);
  }

  // Unset previous default payment methods
  await supabase
    .from('payment_methods')
    .update({ is_default: false })
    .eq('account_id', accountId);

  // Save the new payment method as default
  await supabase.from('payment_methods').insert({
    account_id: accountId,
    stripe_payment_method_id: paymentMethodId,
    last4: card?.last4 || null,
    brand: card?.brand || null,
    exp_month: card?.exp_month || null,
    exp_year: card?.exp_year || null,
    is_default: true,
  });

  // Update accounts.stripe_customer_id if not already set
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  if (customerId) {
    await supabase
      .from('accounts')
      .update({ stripe_customer_id: customerId })
      .eq('id', accountId)
      .is('stripe_customer_id', null);
  }

  return c.html('<html><body><h1>Payment method saved.</h1><p>You can close this tab.</p></body></html>');
});

// GET /v1/payment-methods/cancelled — Stripe redirect after cancelled setup
paymentMethodCallbacks.get('/cancelled', (c) => {
  return c.html('<html><body><h1>Cancelled.</h1><p>No changes were made. You can close this tab.</p></body></html>');
});
