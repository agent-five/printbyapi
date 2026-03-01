import type { Material } from '../types/index.js';

const MATERIAL_RATES: Record<Material, number> = {
  pla: 0.08,
  petg: 0.12,
  abs: 0.10,
  resin: 0.25,
};

const MIN_PRINT_COST = 3.0;
const SUPPORT_FACTOR = 1.15;
const MARGIN = 1.3;
const ORDER_FEE = 1.0;
const FLAT_SHIPPING = 5.99;
const ESTIMATED_DAYS = 5;

export function calculateQuote(volumeCm3: number, material: Material, quantity: number) {
  const materialRate = MATERIAL_RATES[material];
  const unitPrintPrice = Math.max(
    volumeCm3 * materialRate * SUPPORT_FACTOR * MARGIN,
    MIN_PRINT_COST
  );
  const printPrice = round(unitPrintPrice * quantity);
  const shippingPrice = FLAT_SHIPPING;
  const total = round(printPrice + shippingPrice + ORDER_FEE);

  return {
    print_price_usd: printPrice,
    shipping_price_usd: shippingPrice,
    order_fee_usd: ORDER_FEE,
    total_usd: total,
    estimated_days: ESTIMATED_DAYS,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
