-- Add Stripe customer ID to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add Stripe payment intent ID to orders (may already exist from initial schema)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

-- Payment methods stored locally for quick lookup
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  stripe_payment_method_id TEXT NOT NULL,
  last4 TEXT,
  brand TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_account ON payment_methods(account_id);
