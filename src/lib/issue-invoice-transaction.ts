import { Prisma } from "@prisma/client";
import { MAX_CURRENCY_RIAL } from "@/lib/currency";
import { addInventoryStock, reconcileNegativeStockBackorders } from "@/lib/inventory";

type InvoiceItemData = {
  id: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: bigint;
  total: bigint;
};

function allocateAmount(amount: bigint, weights: bigint[]) {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n) throw new Error("INVALID_ALLOCATION");
  const allocations = weights.map((weight) => (amount * weight) / totalWeight);
  let remainder = amount - allocations.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % allocations.length) {
    allocations[index] += 1n;
    remainder -= 1n;
  }
  return allocations;
}

export async function issueInvoiceInTransaction(
  tx: Prisma.TransactionClient,
  businessId: string,
  invoiceId: string
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: {
      id: true,
      businessId: true,
      invoiceNumber: true,
      type: true,
      status: true,
      invoiceDate: true,
      total: true,
      contactId: true,
      subtotal: true,
      extraCosts: true,
      discount: true,
      paymentPlanRecorded: true,
      items: true,
      payments: {
        where: { status: { in: ["PENDING", "CONFIRMED"] } },
        select: { id: true, method: true, amount: true, status: true, checkClearedAt: true },
      },
    },
  });

  if (!invoice) throw new Error("INVOICE_NOT_FOUND");
  if (invoice.status !== "DRAFT") throw new Error("INVOICE_NOT_DRAFT");
  if (invoice.items.length === 0) throw new Error("INVOICE_EMPTY");
  if (invoice.items.some((item) => item.unitPrice <= 0n)) {
    throw new Error("INVOICE_ITEM_PRICE_REQUIRED");
  }
  const paymentTotal = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0n);
  if (invoice.paymentPlanRecorded && paymentTotal !== invoice.total) {
    throw new Error("PAYMENTS_NOT_EQUAL");
  }
  const immediatelyPaidTotal = invoice.payments.reduce(
    (sum, payment) =>
      payment.method === "LEDGER" ||
      (payment.method === "CHECK" && payment.checkClearedAt === null)
        ? sum
        : sum + payment.amount,
    0n
  );
  if (invoice.type === "SALE" && !invoice.contactId && immediatelyPaidTotal < invoice.total) {
    throw new Error("CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT");
  }

  const items = invoice.items as InvoiceItemData[];
  const groupedItems = new Map<string, { quantity: Prisma.Decimal; items: InvoiceItemData[] }>();
  for (const item of items) {
    if (!item.quantity.greaterThan(0)) throw new Error("INVALID_QUANTITY");
    const current = groupedItems.get(item.productId);
    if (current) {
      current.quantity = current.quantity.add(item.quantity);
      current.items.push(item);
    } else {
      groupedItems.set(item.productId, {
        quantity: new Prisma.Decimal(item.quantity),
        items: [item],
      });
    }
  }

  const purchaseCosts = new Map<string, bigint>();
  if (invoice.type === "PURCHASE") {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0n);
    if (subtotal <= 0n) throw new Error("INVALID_PURCHASE_TOTAL");
    if (invoice.discount > subtotal) throw new Error("INVALID_PURCHASE_DISCOUNT");
    const acquisitionTotal = subtotal + invoice.extraCosts - invoice.discount;
    if (acquisitionTotal < 0n) throw new Error("INVALID_ACQUISITION_COST");
    const allocations = allocateAmount(acquisitionTotal, items.map((item) => item.total));
    items.forEach((item, index) => purchaseCosts.set(item.id, allocations[index]));
  }

  for (const [productId, group] of groupedItems) {
    const product = await tx.product.findFirst({
      where: { id: productId, businessId, isActive: true },
      select: { id: true, stock: true, averageCost: true, inventoryValue: true },
    });
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    let newStock: Prisma.Decimal;
    let newInventoryValue: bigint;
    let newAverageCost: Prisma.Decimal;
    let totalCost: bigint;

    if (invoice.type === "PURCHASE") {
      totalCost = group.items.reduce(
        (sum, item) => sum + (purchaseCosts.get(item.id) ?? 0n),
        0n
      );
      const inventory = addInventoryStock(
        product.stock,
        product.inventoryValue,
        group.quantity,
        totalCost
      );
      newStock = inventory.stock;
      newInventoryValue = inventory.inventoryValue;
      newAverageCost = inventory.averageCost;
    } else {
      const available = product.stock.greaterThan(0)
        ? Prisma.Decimal.min(product.stock, group.quantity)
        : new Prisma.Decimal(0);
      newStock = product.stock.sub(group.quantity);
      const calculatedCost =
        available.equals(product.stock) && product.stock.greaterThan(0)
          ? product.inventoryValue
          : BigInt(product.averageCost.mul(available).toFixed(0, Prisma.Decimal.ROUND_HALF_UP));
      totalCost = calculatedCost > product.inventoryValue ? product.inventoryValue : calculatedCost;
      newInventoryValue = product.stock.greaterThan(0)
        ? product.inventoryValue - totalCost
        : 0n;
      newAverageCost = newStock.lessThanOrEqualTo(0)
        ? new Prisma.Decimal(0)
        : new Prisma.Decimal(newInventoryValue.toString()).div(newStock);

      let remainingForCost = available;
      const costedQuantities = group.items.map((item) => {
        const supplied = remainingForCost.greaterThan(0)
          ? Prisma.Decimal.min(item.quantity, remainingForCost)
          : new Prisma.Decimal(0);
        remainingForCost = remainingForCost.sub(supplied);
        return supplied;
      });
      const costWeights = costedQuantities.map((quantity) =>
        BigInt(quantity.mul(1_000_000).toFixed(0, Prisma.Decimal.ROUND_HALF_UP))
      );
      const itemCosts =
        totalCost === 0n
          ? group.items.map(() => 0n)
          : allocateAmount(totalCost, costWeights);

      for (let index = 0; index < group.items.length; index++) {
        await tx.invoiceItem.update({
          where: { id: group.items[index].id },
          data: {
            costOfGoodsSold: itemCosts[index],
            costedQuantity: costedQuantities[index],
          },
        });
      }

      if (group.quantity.greaterThan(available)) {
        let remainingAvailable = available;
        for (const item of group.items) {
          const itemAvailable = remainingAvailable.greaterThan(0)
            ? Prisma.Decimal.min(item.quantity, remainingAvailable)
            : new Prisma.Decimal(0);
          remainingAvailable = remainingAvailable.sub(itemAvailable);
          const outstanding = item.quantity.sub(itemAvailable);
          if (outstanding.greaterThan(0)) {
            await tx.backorder.create({
              data: {
                businessId,
                invoiceId: invoice.id,
                invoiceItemId: item.id,
                productId,
                requested: item.quantity,
                fulfilled: itemAvailable,
                outstanding,
                inventoryDeducted: true,
              },
            });
          }
        }
      }
    }

    if (newInventoryValue > MAX_CURRENCY_RIAL || newInventoryValue < 0n) {
      throw new Error("INVENTORY_VALUE_OVERFLOW");
    }
    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        businessId,
        isActive: true,
        stock: product.stock,
        averageCost: product.averageCost,
        inventoryValue: product.inventoryValue,
      },
      data: { stock: newStock, averageCost: newAverageCost, inventoryValue: newInventoryValue },
    });
    if (updated.count !== 1) throw new Error("STOCK_CONFLICT");

    if (group.quantity.greaterThan(0)) {
      const movement = await tx.inventoryMovement.create({
        data: {
          businessId,
          productId,
          invoiceId: invoice.id,
          type: invoice.type === "PURCHASE" ? "PURCHASE" : "SALE",
          quantity: group.quantity,
          totalCost,
          averageCost: newAverageCost,
          description: `صدور فاکتور ${invoice.invoiceNumber}`,
        },
      });
      if (invoice.type === "PURCHASE") {
        await reconcileNegativeStockBackorders(tx, movement);
      }
    }
  }

  const issuedAt = new Date();
  const issued = await tx.invoice.updateMany({
    where: { id: invoice.id, businessId, status: "DRAFT" },
    data: { status: "ISSUED", issuedAt, costingRecordedAt: null },
  });
  if (issued.count !== 1) throw new Error("INVOICE_ALREADY_ISSUED");

  await tx.payment.updateMany({
    where: {
      invoiceId: invoice.id,
      businessId,
      status: "PENDING",
      allocationBatchId: null,
    },
    data: { allocationBatchId: crypto.randomUUID() },
  });
  await tx.payment.updateMany({
    where: { invoiceId: invoice.id, businessId, status: "PENDING" },
    data: { status: "CONFIRMED" },
  });

  if (invoice.type === "SALE") {
    const issuedItems = await tx.invoiceItem.findMany({
      where: { invoiceId: invoice.id },
      select: { quantity: true, costedQuantity: true },
    });
    if (issuedItems.every((item) => item.costedQuantity.greaterThanOrEqualTo(item.quantity))) {
      await tx.invoice.updateMany({
        where: { id: invoice.id, businessId, status: "ISSUED" },
        data: { costingRecordedAt: issuedAt },
      });
    }
  }

  return tx.invoice.findUnique({
    where: { id: invoice.id },
    select: { id: true, invoiceNumber: true, type: true, status: true, issuedAt: true, total: true },
  });
}
