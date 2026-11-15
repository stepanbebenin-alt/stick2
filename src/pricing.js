/**
 * Shared pricing and quantity helpers for imastik sticker packs.
 * Pack tiers:
 *   5 stickers  -> EUR 5.00  (EUR 1.00 each)
 *   10 stickers -> EUR 8.00  (EUR 0.80 each)
 *   20 stickers -> EUR 15.00 (EUR 0.75 each)
 *   20+         -> EUR 15.00 + (qty - 20) * 0.75
 */

export const MIN_QUANTITY = 5;
export const MAX_QUANTITY = 200;
export const QUANTITY_STEP = 5;

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

export function clampQuantity(value) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return MIN_QUANTITY;
  return Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, num));
}

export function calculateStickerPrice(quantity) {
  const qty = clampQuantity(quantity);
  if (qty <= 5) return 5;
  if (qty <= 10) return roundCents(5 + (qty - 5) * 0.6);
  if (qty <= 20) return roundCents(8 + (qty - 10) * 0.7);
  return roundCents(15 + (qty - 20) * 0.75);
}

export function formatEuro(amount) {
  return `€${Number(amount).toFixed(2)}`;
}
