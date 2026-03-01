// TODO: Phase 2 — Stripe integration
//
// Implement:
// - createPaymentIntent(amountUsd: number, accountId: string): Promise<string>
//   Creates a Stripe PaymentIntent and returns the payment_intent_id
//
// - confirmPaymentIntent(paymentIntentId: string): Promise<boolean>
//   Confirms payment was successful
//
// - handleWebhook(body: string, signature: string): Promise<StripeEvent>
//   Validates and parses incoming Stripe webhook events
//
// - refundPayment(paymentIntentId: string): Promise<void>
//   Issues a full refund for a cancelled order
//
// import Stripe from 'stripe';
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createPaymentIntent(_amountUsd: number, _accountId: string): Promise<string | null> {
  // TODO: Create Stripe PaymentIntent
  // const intent = await stripe.paymentIntents.create({
  //   amount: Math.round(amountUsd * 100),
  //   currency: 'usd',
  //   metadata: { account_id: accountId },
  // });
  // return intent.id;
  return null;
}

export async function confirmPaymentIntent(_paymentIntentId: string): Promise<boolean> {
  // TODO: Verify payment was captured
  return true;
}
