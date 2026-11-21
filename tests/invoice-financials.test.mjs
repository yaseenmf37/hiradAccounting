import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateInvoiceAmount,
  calculatePercentageDiscount,
  calculatePurchaseItemCosts,
  calculateReturnedSaleRevenue,
  calculateSaleNetProfit,
  estimateSaleCost,
} from "../src/lib/invoice-financials.ts";

test("purchase cost allocation includes landed costs and discounts by item value", () => {
  const itemCosts = calculatePurchaseItemCosts(
    [{ total: 1_000n }, { total: 3_000n }],
    400n,
    200n,
  );
  assert.deepEqual(itemCosts, [1_050n, 3_150n]);
  assert.equal(itemCosts.reduce((sum, value) => sum + value, 0n), 4_200n);
});

test("percentage discounts use the same half-up Rial rounding for invoices and previews", () => {
  assert.equal(calculatePercentageDiscount(10_000n, "12.5"), 1_250n);
  assert.equal(calculatePercentageDiscount(5n, "10"), 1n);
  assert.equal(calculatePercentageDiscount(10_000n, "100"), 10_000n);
  assert.throws(() => calculatePercentageDiscount(10_000n, "100.01"), {
    message: "INVALID_DISCOUNT_PERCENT",
  });
  assert.throws(() => calculatePercentageDiscount(10_000n, "12.345"), {
    message: "INVALID_DISCOUNT_PERCENT",
  });
});

test("weighted average cost handles mixed purchase prices and fractional sale quantities", () => {
  const result = estimateSaleCost(
    [{ productId: "p1", quantity: "1.25" }],
    [{
      id: "p1",
      stock: "5",
      averageCost: "160",
      inventoryValue: "800",
    }],
  );
  assert.deepEqual(result, { totalCost: 200n, fullyCosted: true });
});

test("sale costing caps the estimate at available stock and flags the uncosted remainder", () => {
  const result = estimateSaleCost(
    [{ productId: "p1", quantity: "4" }],
    [{
      id: "p1",
      stock: "2.5",
      averageCost: "100.25",
      inventoryValue: "251",
    }],
  );
  assert.deepEqual(result, { totalCost: 251n, fullyCosted: false });
});

test("sale cost distribution preserves exact totals across repeated product rows", () => {
  assert.deepEqual(allocateInvoiceAmount(10n, [1n, 1n, 1n]), [4n, 3n, 3n]);
});

test("sale net profit deducts actual cost, discount, and extra expenses without hiding real losses", () => {
  assert.equal(calculateSaleNetProfit(1_000n, 100n, 50n, 600n), 250n);
  assert.equal(calculateSaleNetProfit(1_000n, 100n, 50n, 900n), -50n);
});

test("returned invoice amounts remove only the sale revenue portion, not billed extra costs", () => {
  assert.equal(calculateReturnedSaleRevenue(600n, 1_000n, 0n, 1_200n), 500n);
  assert.equal(calculateReturnedSaleRevenue(5n, 10n, 2n, 0n), 0n);
});
