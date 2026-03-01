import Stripe from 'stripe';
import { supabase } from './db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Get an existing Stripe customer for the account, or create one.
 * Caches the stripe_customer_id on the accounts table.
 */
export async function getOrCreateCustomer(accountId: string, email: string): Promise<string> {
  // Check if we already have a customer ID stored
  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_customer_id')
    .eq('id', accountId)
    .single();

  if (account?.stripe_customer_id) {
    return account.stripe_customer_id;
  }

  // Create a new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: { account_id: accountId },
  });

  // Store the customer ID
  await supabase
    .from('accounts')
    .update({ stripe_customer_id: customer.id })
    .eq('id', accountId);

  return customer.id;
}

/**
 * Create a Checkout Session in 'setup' mode so the user can save a card.
 */
export async function createCheckoutSession(
  customerId: string,
  accountId: string
): Promise<{ url: string; id: string }> {
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    payment_method_types: ['card'],
    customer: customerId,
    success_url:
      process.env.STRIPE_SUCCESS_URL ||
      'https://api.printbyapi.com/v1/payment-methods/complete?session_id={CHECKOUT_SESSION_ID}',
    cancel_url:
      process.env.STRIPE_CANCEL_URL ||
      'https://api.printbyapi.com/v1/payment-methods/cancelled',
    metadata: { account_id: accountId },
  });

  return { url: session.url!, id: session.id };
}

/**
 * Retrieve a Checkout Session by ID.
 */
export async function retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.retrieve(sessionId);
}

/**
 * Retrieve a SetupIntent by ID.
 */
export async function retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
  return stripe.setupIntents.retrieve(setupIntentId);
}

/**
 * Attach a payment method to a customer and return card details.
 */
export async function attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<Stripe.PaymentMethod> {
  const pm = await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  // Set as default payment method on the customer
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  return pm;
}

/**
 * Retrieve a payment method from Stripe.
 */
export async function retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
  return stripe.paymentMethods.retrieve(paymentMethodId);
}

/**
 * Detach a payment method from its customer.
 */
export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  await stripe.paymentMethods.detach(paymentMethodId);
}

/**
 * Get the default payment method for a customer from Stripe.
 */
export async function getDefaultPaymentMethod(customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const defaultPm = customer.invoice_settings?.default_payment_method;
  if (typeof defaultPm === 'string') return defaultPm;
  if (defaultPm && typeof defaultPm === 'object') return defaultPm.id;
  return null;
}

/**
 * Charge an order using a confirmed payment method (immediate capture).
 */
export async function chargeOrder(
  customerId: string,
  amountCents: number,
  orderId: string,
  metadata: Record<string, string>
): Promise<Stripe.PaymentIntent> {
  // Get the default payment method
  const defaultPm = await getDefaultPaymentMethod(customerId);
  if (!defaultPm) {
    throw new Error('No default payment method on file');
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method: defaultPm,
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    metadata: {
      order_id: orderId,
      ...metadata,
    },
  });

  return paymentIntent;
}

/**
 * Issue a full refund for a payment intent.
 */
export async function refundOrder(paymentIntentId: string): Promise<Stripe.Refund> {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
  });
}
