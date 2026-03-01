import { Hono } from 'hono';
import { supabase } from '../lib/db.js';
import {
  getOrCreateCustomer,
  createSetupIntent,
  retrievePaymentMethod,
  attachPaymentMethod,
  detachPaymentMethod,
} from '../lib/stripe.js';
import type { Env } from '../types/index.js';

const paymentMethods = new Hono<Env>();

// POST /v1/payment-methods/setup — create a SetupIntent for collecting card details
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
  const { client_secret, setup_intent_id } = await createSetupIntent(customerId);

  return c.json({
    setup_intent_id,
    client_secret,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
  });
});

// POST /v1/payment-methods/confirm — confirm and save a payment method
paymentMethods.post('/confirm', async (c) => {
  const accountId = c.get('account_id');
  const body = await c.req.json<{
    setup_intent_id: string;
    payment_method_id: string;
  }>();

  if (!body.setup_intent_id || !body.payment_method_id) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'setup_intent_id and payment_method_id are required',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Get account and Stripe customer
  const { data: account } = await supabase
    .from('accounts')
    .select('email, stripe_customer_id')
    .eq('id', accountId)
    .single();

  if (!account?.stripe_customer_id) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'No Stripe customer found. Call /setup first.',
          request_id: c.get('request_id'),
        },
      },
      400
    );
  }

  // Retrieve the payment method from Stripe to get card details
  const pm = await retrievePaymentMethod(body.payment_method_id);
  const card = pm.card;

  // Attach the payment method to the customer
  await attachPaymentMethod(account.stripe_customer_id, body.payment_method_id);

  // Unset any previous default payment methods for this account
  await supabase
    .from('payment_methods')
    .update({ is_default: false })
    .eq('account_id', accountId);

  // Save the new payment method as default
  await supabase.from('payment_methods').insert({
    account_id: accountId,
    stripe_payment_method_id: body.payment_method_id,
    last4: card?.last4 || null,
    brand: card?.brand || null,
    exp_month: card?.exp_month || null,
    exp_year: card?.exp_year || null,
    is_default: true,
  });

  return c.json({
    payment_method_id: body.payment_method_id,
    brand: card?.brand || null,
    last4: card?.last4 || null,
    exp_month: card?.exp_month || null,
    exp_year: card?.exp_year || null,
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
