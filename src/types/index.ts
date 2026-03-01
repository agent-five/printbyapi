export interface Account {
  id: string;
  email: string;
  tier: 'free' | 'growth' | 'scale' | 'enterprise';
  created_at: string;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  account_id: string;
  name: string | null;
  is_test: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface FileRecord {
  id: string;
  account_id: string;
  original_name: string;
  storage_key: string;
  size_bytes: number;
  format: string;
  volume_cm3: number | null;
  bounding_box: BoundingBox | null;
  created_at: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface ShipTo {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface Quote {
  id: string;
  account_id: string;
  file_id: string;
  material: Material;
  color: string;
  quality: string;
  quantity: number;
  ship_to: ShipTo;
  print_price_usd: number;
  shipping_price_usd: number;
  order_fee_usd: number;
  total_usd: number;
  estimated_days: number;
  expires_at: string;
  created_at: string;
}

export type Material = 'pla' | 'petg' | 'abs' | 'resin';

export type OrderStatus =
  | 'confirmed'
  | 'queued'
  | 'printing'
  | 'quality_check'
  | 'shipped'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export interface Order {
  id: string;
  account_id: string;
  quote_id: string;
  idempotency_key: string | null;
  status: OrderStatus;
  tracking_number: string | null;
  tracking_url: string | null;
  stripe_payment_intent_id: string | null;
  vendor_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  status: string;
  note: string | null;
  created_at: string;
}

export interface Webhook {
  id: string;
  account_id: string;
  url: string;
  secret: string;
  is_active: boolean;
  created_at: string;
}

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED';

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
  };
}

export interface Env {
  Variables: {
    account_id: string;
    request_id: string;
  };
}
