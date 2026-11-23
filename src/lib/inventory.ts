
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
    if (incomingCost === 0n) {
      inventoryValue = currentInventoryValue;
    } else {
      const positiveStock = stock.greaterThan(0)
        ? stock
        : new Prisma.Decimal(0);

      const quantityUnits = BigInt(quantity.mul(1_000_000).toFixed(0));
      const positiveUnits = BigInt(positiveStock.mul(1_000_000).toFixed(0));

      inventoryValue =
        quantityUnits > 0n
          ? (incomingCost * positiveUnits) / quantityUnits
          : 0n;
    }
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

function prorateCost(
  totalCost: bigint,
  part: Prisma.Decimal,
  whole: Prisma.Decimal,
) {
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
  if (
    !["PURCHASE", "ADJUSTMENT_IN", "RETURN_IN", "INITIAL_STOCK"].includes(
      movement.type,
    )
  ) {
    return;
  }

  const backorders = await tx.backorder.findMany({
    where: {
      businessId: movement.businessId,
      productId: movement.productId,
      inventoryDeducted: true,
      cancelledAt: null,
      outstanding: { gt: 0 },
      invoice: {
        is: {
          type: "SALE",
          status: "ISSUED",
        },
      },
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

  if (backorders.length === 0) return;

  const invoiceIds = [
    ...new Set(backorders.map((item) => item.invoice.id)),
  ];

  // دریافت گروهی حرکت‌های فروش به‌جای اجرای findFirst در هر دور حلقه
  const saleMovements = await tx.inventoryMovement.findMany({
    where: {
      businessId: movement.businessId,
      productId: movement.productId,
      invoiceId: { in: invoiceIds },
      type: "SALE",
      salesReturnId: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      invoiceId: true,
    },
  });

  const saleMovementByInvoice = new Map<string, string>();

  for (const saleMovement of saleMovements) {
    if (
      saleMovement.invoiceId &&
      !saleMovementByInvoice.has(saleMovement.invoiceId)
    ) {
      saleMovementByInvoice.set(
        saleMovement.invoiceId,
        saleMovement.id,
      );
    }
  }

  let remainingQuantity = new Prisma.Decimal(movement.quantity);
  let remainingCost = movement.totalCost;

  const affectedInvoiceIds = new Set<string>();

  for (const backorder of backorders) {
    if (remainingQuantity.lessThanOrEqualTo(0)) break;

    if (!backorder.invoiceItem) {
      throw new Error("NEGATIVE_STOCK_BACKORDER_ITEM_MISSING");
    }

    const quantity = Prisma.Decimal.min(
      backorder.outstanding,
      remainingQuantity,
    );

    const cost = quantity.equals(remainingQuantity)
      ? remainingCost
      : prorateCost(remainingCost, quantity, remainingQuantity);

    const saleMovementId = saleMovementByInvoice.get(
      backorder.invoice.id,
    );

    if (!saleMovementId) {
      throw new Error("NEGATIVE_STOCK_SALE_MOVEMENT_MISSING");
    }

    const itemUpdated = await tx.invoiceItem.updateMany({
      where: {
        id: backorder.invoiceItem.id,
        costedQuantity: backorder.invoiceItem.costedQuantity,
        quantity: {
          gte: backorder.invoiceItem.costedQuantity.add(quantity),
        },
      },
      data: {
        costedQuantity: { increment: quantity },
        costOfGoodsSold: { increment: cost },
      },
    });

    if (itemUpdated.count !== 1) {
      throw new Error("NEGATIVE_STOCK_BACKORDER_CONFLICT");
    }

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

    if (backorderUpdated.count !== 1) {
      throw new Error("NEGATIVE_STOCK_BACKORDER_CONFLICT");
    }

    await tx.inventoryMovement.update({
      where: { id: saleMovementId },
      data: {
        totalCost: { increment: cost },
      },
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

  if (affectedInvoiceIds.size === 0) return;

  const affectedIds = [...affectedInvoiceIds];

  // دریافت گروهی Backorderهای باقی‌مانده تمام فاکتورها
  const remainingBackorders = await tx.backorder.findMany({
    where: {
      invoiceId: { in: affectedIds },
      cancelledAt: null,
      outstanding: { gt: 0 },
      invoice: {
        is: {
          type: "SALE",
          status: "ISSUED",
        },
      },
    },
    select: {
      invoiceId: true,
    },
  });

  const invoicesWithBackorders = new Set(
    remainingBackorders.map((item) => item.invoiceId),
  );

  // دریافت گروهی اقلام فاکتورها
  const invoiceItems = await tx.invoiceItem.findMany({
    where: {
      invoiceId: { in: affectedIds },
    },
    select: {
      invoiceId: true,
      quantity: true,
      costedQuantity: true,
    },
  });

  const itemsByInvoice = new Map<
    string,
    Array<{
      quantity: Prisma.Decimal;
      costedQuantity: Prisma.Decimal;
    }>
  >();

  for (const item of invoiceItems) {
    const items = itemsByInvoice.get(item.invoiceId) ?? [];
    items.push(item);
    itemsByInvoice.set(item.invoiceId, items);
  }

  const completedInvoiceIds = affectedIds.filter((invoiceId) => {
    if (invoicesWithBackorders.has(invoiceId)) return false;

    const items = itemsByInvoice.get(invoiceId) ?? [];

    return (
      items.length > 0 &&
      items.every((item) =>
        item.costedQuantity.greaterThanOrEqualTo(item.quantity),
      )
    );
  });

  if (completedInvoiceIds.length > 0) {
    await tx.invoice.updateMany({
      where: {
        id: { in: completedInvoiceIds },
        businessId: movement.businessId,
        type: "SALE",
        status: "ISSUED",
      },
      data: {
        costingRecordedAt: new Date(),
      },
    });
  }
}
