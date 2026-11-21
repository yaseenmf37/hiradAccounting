const QUANTITY_SCALE = 1_000n;
const COST_SCALE = 1_000_000_000n;

export function allocateInvoiceAmount(amount: bigint, weights: bigint[]) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weights.length === 0 || totalWeight <= 0n) {
    throw new Error("INVALID_ALLOCATION");
  }

  const allocations = weights.map((weight) => (amount * weight) / totalWeight);
  let remainder = amount - allocations.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % allocations.length) {
    allocations[index] += 1n;
    remainder -= 1n;
  }
  return allocations;
}

export function calculatePercentageDiscount(subtotal: bigint, percent: string) {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(percent)) {
    throw new Error("INVALID_DISCOUNT_PERCENT");
  }
  const scaledPercent = decimalToScaledInteger(percent, 100n);
  if (scaledPercent < 0n || scaledPercent > 10_000n) {
    throw new Error("INVALID_DISCOUNT_PERCENT");
  }
  return (subtotal * scaledPercent + 5_000n) / 10_000n;
}

export function calculatePurchaseItemCosts(
  items: { total: bigint }[],
  extraCosts: bigint,
  discount: bigint,
) {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0n);
  if (subtotal <= 0n) throw new Error("INVALID_PURCHASE_TOTAL");
  if (discount < 0n || discount > subtotal) throw new Error("INVALID_PURCHASE_DISCOUNT");

  const acquisitionTotal = subtotal + extraCosts - discount;
  if (acquisitionTotal < 0n) throw new Error("INVALID_ACQUISITION_COST");
  return allocateInvoiceAmount(acquisitionTotal, items.map((item) => item.total));
}

function decimalToScaledInteger(value: string, scale: bigint) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("INVALID_DECIMAL");
  const precision = scale.toString().length - 1;
  const fraction = (match[3] ?? "").padEnd(precision, "0").slice(0, precision);
  const result = BigInt(match[2]) * scale + BigInt(fraction || "0");
  return match[1] ? -result : result;
}

function roundHalfUp(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

type SaleCostItem = { productId: string; quantity: string };
type SaleCostProduct = {
  id: string;
  stock: string;
  averageCost: string;
  inventoryValue: string;
};

export function estimateSaleCost(
  items: SaleCostItem[],
  products: SaleCostProduct[],
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const quantitiesByProduct = new Map<string, bigint>();
  for (const item of items) {
    const quantity = decimalToScaledInteger(item.quantity, QUANTITY_SCALE);
    if (quantity <= 0n) throw new Error("INVALID_QUANTITY");
    quantitiesByProduct.set(
      item.productId,
      (quantitiesByProduct.get(item.productId) ?? 0n) + quantity,
    );
  }

  let totalCost = 0n;
  let fullyCosted = true;
  for (const [productId, requested] of quantitiesByProduct) {
    const product = productsById.get(productId);
    if (!product) {
      fullyCosted = false;
      continue;
    }

    const stock = decimalToScaledInteger(product.stock, QUANTITY_SCALE);
    const available = stock > 0n
      ? stock < requested ? stock : requested
      : 0n;
    if (available < requested) fullyCosted = false;

    const inventoryValue = BigInt(product.inventoryValue);
    const averageCost = decimalToScaledInteger(product.averageCost, COST_SCALE);
    const calculatedCost = available === stock && stock > 0n
      ? inventoryValue
      : roundHalfUp(averageCost * available, COST_SCALE * QUANTITY_SCALE);
    totalCost += calculatedCost > inventoryValue ? inventoryValue : calculatedCost;
  }

  return { totalCost, fullyCosted };
}

export function calculateSaleNetProfit(
  subtotal: bigint,
  extraCosts: bigint,
  discount: bigint,
  costOfGoodsSold: bigint,
  returnedSales = 0n,
  returnedCost = 0n,
) {
  return subtotal - extraCosts - discount - costOfGoodsSold - returnedSales + returnedCost;
}

export function calculateReturnedSaleRevenue(
  returnAmount: bigint,
  invoiceSubtotal: bigint,
  invoiceDiscount: bigint,
  invoiceTotal: bigint,
) {
  const netSales = invoiceSubtotal - invoiceDiscount;
  return invoiceTotal > 0n
    ? (returnAmount * netSales + invoiceTotal / 2n) / invoiceTotal
    : 0n;
}
