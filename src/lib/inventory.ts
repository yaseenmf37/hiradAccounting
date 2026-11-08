import { Prisma } from "@prisma/client";

export function addInventoryStock(
  currentStock: Prisma.Decimal,
  currentInventoryValue: bigint,
  quantity: Prisma.Decimal,
  incomingCost: bigint,
) {
  const stock = currentStock.add(quantity);
  let inventoryValue: bigint;

  if (currentStock.lessThan(0)) {
    const positiveStock = stock.greaterThan(0) ? stock : new Prisma.Decimal(0);
    const quantityUnits = BigInt(quantity.mul(1_000_000).toFixed(0));
    const positiveUnits = BigInt(positiveStock.mul(1_000_000).toFixed(0));
    inventoryValue = quantityUnits > 0n
      ? (incomingCost * positiveUnits) / quantityUnits
      : 0n;
  } else {
    inventoryValue = currentInventoryValue + incomingCost;
  }

  return {
    stock,
    inventoryValue,
    averageCost: stock.greaterThan(0)
      ? new Prisma.Decimal(inventoryValue.toString()).div(stock)
      : new Prisma.Decimal(0),
  };
}

function prorateCost(totalCost: bigint, part: Prisma.Decimal, whole: Prisma.Decimal) {
  const partUnits = BigInt(part.mul(1000).toFixed(0));
  const wholeUnits = BigInt(whole.mul(1000).toFixed(0));
  return wholeUnits === 0n
    ? 0n
    : (totalCost * partUnits + wholeUnits / 2n) / wholeUnits;
}

export async function reconcileNegativeStockBackorders(
  tx: Prisma.TransactionClient,
  movement: {
    id: string;
    businessId: string;
    productId: string;
    quantity: Prisma.Decimal;
    totalCost: bigint;
    type: string;
  },
) {
  if (!["PURCHASE", "ADJUSTMENT_IN", "RETURN_IN", "INITIAL_STOCK"].includes(movement.type)) return;

  const backorders = await tx.backorder.findMany({
    where: {
      businessId: movement.businessId,
      productId: movement.productId,
      inventoryDeducted: true,
      cancelledAt: null,
      outstanding: { gt: 0 },
      invoice: { is: { type: "SALE", status: "ISSUED" } },
    },
    include: {
      invoice: { select: { id: true } },
      invoiceItem: {
        select: {
          id: true,
          quantity: true,
          costedQuantity: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  let remainingQuantity = new Prisma.Decimal(movement.quantity);
  let remainingCost = movement.totalCost;
  const affectedInvoiceIds = new Set<string>();

  for (const backorder of backorders) {
    if (remainingQuantity.lessThanOrEqualTo(0)) break;
    if (!backorder.invoiceItem) {
      throw new Error("NEGATIVE_STOCK_BACKORDER_ITEM_MISSING");
    }

    const quantity = Prisma.Decimal.min(backorder.outstanding, remainingQuantity);
    const cost = quantity.equals(remainingQuantity)
      ? remainingCost
      : prorateCost(remainingCost, quantity, remainingQuantity);

    const itemUpdated = await tx.invoiceItem.updateMany({
      where: {
        id: backorder.invoiceItem.id,
        costedQuantity: backorder.invoiceItem.costedQuantity,
        quantity: { gte: backorder.invoiceItem.costedQuantity.add(quantity) },
      },
      data: {
        costedQuantity: { increment: quantity },
        costOfGoodsSold: { increment: cost },
      },
    });
    if (itemUpdated.count !== 1) throw new Error("NEGATIVE_STOCK_BACKORDER_CONFLICT");

    const backorderUpdated = await tx.backorder.updateMany({
      where: {
        id: backorder.id,
        outstanding: backorder.outstanding,
        cancelledAt: null,
      },
      data: {
        fulfilled: { increment: quantity },
        outstanding: { decrement: quantity },
      },
    });
    if (backorderUpdated.count !== 1) throw new Error("NEGATIVE_STOCK_BACKORDER_CONFLICT");

    const saleMovement = await tx.inventoryMovement.findFirst({
      where: {
        businessId: movement.businessId,
        productId: movement.productId,
        invoiceId: backorder.invoice.id,
        type: "SALE",
        salesReturnId: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!saleMovement) throw new Error("NEGATIVE_STOCK_SALE_MOVEMENT_MISSING");

    await tx.inventoryMovement.update({
      where: { id: saleMovement.id },
      data: { totalCost: { increment: cost } },
    });
    await tx.backorderAllocation.create({
      data: {
        backorderId: backorder.id,
        quantity,
        totalCost: cost,
        inventoryMovementId: movement.id,
      },
    });

    remainingQuantity = remainingQuantity.sub(quantity);
    remainingCost -= cost;
    affectedInvoiceIds.add(backorder.invoice.id);
  }

  for (const invoiceId of affectedInvoiceIds) {
    const [remainingBackorders, items] = await Promise.all([
      tx.backorder.count({
        where: {
          invoiceId,
          cancelledAt: null,
          outstanding: { gt: 0 },
          invoice: { is: { type: "SALE", status: "ISSUED" } },
        },
      }),
      tx.invoiceItem.findMany({
        where: { invoiceId },
        select: { quantity: true, costedQuantity: true },
      }),
    ]);

    if (
      remainingBackorders === 0 &&
      items.every((item) => item.costedQuantity.greaterThanOrEqualTo(item.quantity))
    ) {
      await tx.invoice.updateMany({
        where: { id: invoiceId, businessId: movement.businessId, type: "SALE", status: "ISSUED" },
        data: { costingRecordedAt: new Date() },
      });
    }
  }
}
