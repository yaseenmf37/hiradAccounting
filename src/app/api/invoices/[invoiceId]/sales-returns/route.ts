import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { currencyInputToRial, MAX_CURRENCY_RIAL } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { addInventoryStock, reconcileNegativeStockBackorders } from "@/lib/inventory";

type RouteContext = { params: Promise<{ invoiceId: string }> };
type ReturnLineInput = { invoiceItemId: string; quantity: string; unitPrice?: string };
type ReturnRow = {
  id: string;
  invoiceId: string;
  returnNumber: string;
  total: bigint;
  description: string | null;
  createdAt: Date;
};
type ReturnItemRow = {
  id: string;
  invoiceItemId: string;
  productId: string;
  quantity: Prisma.Decimal;
  amount: bigint;
  inventoryCost: bigint;
  productName: string;
  productUnit: string;
};
type ReturnPaymentRow = {
  method: string;
  amount: bigint;
  description: string | null;
  checkNumber: string | null;
  checkIssuedAt: Date | null;
  checkDueAt: Date | null;
  payableTo: string | null;
  destinationDetails: string | null;
};

const requestSchema = z.object({
  items: z.array(z.object({
    invoiceItemId: z.string().min(1),
    quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
    unitPrice: z.string().regex(/^\d{1,18}(\.\d)?$/).optional(),
  })).min(1).max(100).superRefine((items, ctx) => {
    const itemIds = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (itemIds.has(item.invoiceItemId)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "invoiceItemId"],
          message: "هر قلم فاکتور فقط یک‌بار در مرجوعی درج شود.",
        });
      }
      itemIds.add(item.invoiceItemId);
    }
  }),
  refundAmount: z.string().regex(/^\d{1,18}(\.\d)?$/).default("0"),
  refundMethod: z.enum(["CASH", "CHECK", "CARD_TO_CARD", "BANK_TRANSFER", "POS"]).optional(),
  refundDescription: z.string().trim().max(1000).nullable().optional(),
  refundCheckNumber: z.string().trim().max(100).nullable().optional(),
  refundCheckIssuedAt: z.string().date().nullable().optional(),
  refundCheckDueAt: z.string().date().nullable().optional(),
  refundPayableTo: z.string().trim().max(150).nullable().optional(),
  refundDestinationDetails: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().trim().min(16).max(128),
});

function splitInvoiceTotal(total: bigint, weights: bigint[]) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) return weights.map(() => 0n);

  const allocations = weights.map((weight) => (total * weight) / totalWeight);
  let remainder = total - allocations.reduce((sum, amount) => sum + amount, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % allocations.length) {
    allocations[index] += 1n;
    remainder -= 1n;
  }
  return allocations;
}

function prorateAmount(amount: bigint, part: Prisma.Decimal, whole: Prisma.Decimal) {
  const scale = new Prisma.Decimal(1000);
  const partUnits = BigInt(part.mul(scale).toFixed(0));
  const wholeUnits = BigInt(whole.mul(scale).toFixed(0));
  return wholeUnits === 0n ? 0n : (amount * partUnits + wholeUnits / 2n) / wholeUnits;
}

function hashRequest(
  invoiceId: string,
  items: ReturnLineInput[],
  data: z.infer<typeof requestSchema>,
) {
  const aggregated = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    aggregated.set(
      item.invoiceItemId,
      (aggregated.get(item.invoiceItemId) ?? new Prisma.Decimal(0))
        .add(new Prisma.Decimal(item.quantity)),
    );
  }
  return createHash("sha256").update(JSON.stringify({
    invoiceId,
    items: [...aggregated.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([invoiceItemId, quantity]) => [
        invoiceItemId,
        quantity.toFixed(3),
        items.find((item) => item.invoiceItemId === invoiceItemId)?.unitPrice ?? null,
      ]),
    refundAmount: data.refundAmount,
    refundMethod: data.refundMethod ?? null,
    refundDescription: data.refundDescription ?? null,
    refundCheckNumber: data.refundCheckNumber ?? null,
    refundCheckIssuedAt: data.refundCheckIssuedAt ?? null,
    refundCheckDueAt: data.refundCheckDueAt ?? null,
    refundPayableTo: data.refundPayableTo ?? null,
    refundDestinationDetails: data.refundDestinationDetails ?? null,
    description: data.description ?? null,
  })).digest("hex");
}

async function findExistingReturn(
  client: Prisma.TransactionClient | typeof prisma,
  businessId: string,
  idempotencyKey: string,
) {
  const [returns, items, payments] = await Promise.all([
    client.$queryRaw<ReturnRow[]>`
      SELECT "id", "invoiceId", "returnNumber", "total", "description", "createdAt"
      FROM "SalesReturn"
      WHERE "businessId" = ${businessId} AND "idempotencyKey" = ${idempotencyKey}
      LIMIT 1
    `,
    client.$queryRaw<(ReturnItemRow & { salesReturnId: string })[]>`
      SELECT item."id", item."salesReturnId", item."invoiceItemId", item."productId",
        item."quantity", item."amount", item."inventoryCost",
        product."name" AS "productName", product."unit" AS "productUnit"
      FROM "SalesReturnItem" item
      JOIN "Product" product
        ON product."id" = item."productId" AND product."businessId" = item."businessId"
      JOIN "SalesReturn" salesReturn
        ON salesReturn."id" = item."salesReturnId"
       AND salesReturn."businessId" = item."businessId"
       AND salesReturn."invoiceId" = item."invoiceId"
      WHERE salesReturn."businessId" = ${businessId}
        AND salesReturn."idempotencyKey" = ${idempotencyKey}
      ORDER BY item."id"
    `,
    client.$queryRaw<(ReturnPaymentRow & { salesReturnId: string })[]>`
      SELECT payment."salesReturnId", payment."method", payment."amount", payment."description",
        payment."checkNumber", payment."checkIssuedAt", payment."checkDueAt",
        payment."payableTo", payment."destinationDetails"
      FROM "Payment" payment
      JOIN "SalesReturn" salesReturn
        ON salesReturn."id" = payment."salesReturnId"
       AND salesReturn."businessId" = payment."businessId"
      WHERE salesReturn."businessId" = ${businessId}
        AND salesReturn."idempotencyKey" = ${idempotencyKey}
      ORDER BY payment."paidAt", payment."id"
    `,
  ]);
  const row = returns[0];
  if (!row) return null;
  return {
    ...row,
    total: row.total.toString(),
    items: items.filter((item) => item.salesReturnId === row.id).map((item) => ({
      id: item.id,
      invoiceItemId: item.invoiceItemId,
      productId: item.productId,
      quantity: item.quantity.toString(),
      amount: item.amount.toString(),
      inventoryCost: item.inventoryCost.toString(),
      product: { name: item.productName, unit: item.productUnit },
    })),
    payments: payments.filter((payment) => payment.salesReturnId === row.id).map((payment) => ({
      method: payment.method,
      amount: payment.amount.toString(),
      description: payment.description,
      checkNumber: payment.checkNumber,
      checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
      checkDueAt: payment.checkDueAt?.toISOString() ?? null,
      payableTo: payment.payableTo,
      destinationDetails: payment.destinationDetails,
    })),
  };
}

export async function POST(request: Request, context: RouteContext) {
  let businessId: string | null = null;
  let invoiceId: string | null = null;
  let requestHash: string | null = null;
  let idempotencyKey: string | null = null;

  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "اطلاعات مرجوعی معتبر نیست." }, { status: 400 });
    }
    invoiceId = (await context.params).invoiceId;
    businessId = user.business.id;
    idempotencyKey = parsed.data.idempotencyKey;
    requestHash = hashRequest(invoiceId, parsed.data.items, parsed.data);
    const tenantId = user.business.id;
    const requestKey = parsed.data.idempotencyKey;
    const fingerprint = hashRequest(invoiceId, parsed.data.items, parsed.data);

    let refundAmount: bigint;
    try {
      refundAmount = currencyInputToRial(parsed.data.refundAmount, user.business.currencyUnit);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURRENCY_AMOUNT") {
        return NextResponse.json({ message: "مبلغ بازپرداخت معتبر نیست." }, { status: 400 });
      }
      throw error;
    }
    if (refundAmount < 0n || refundAmount > MAX_CURRENCY_RIAL) {
      return NextResponse.json({ message: "مبلغ بازپرداخت معتبر نیست." }, { status: 400 });
    }
    const requestedUnitPrices = new Map<string, bigint>();
    for (const item of parsed.data.items) {
      if (item.unitPrice === undefined) continue;
      try {
        const unitPrice = currencyInputToRial(item.unitPrice, user.business.currencyUnit);
        if (unitPrice > MAX_CURRENCY_RIAL) {
          return NextResponse.json({ message: "قیمت مرجوعی از محدوده مجاز سامانه بیشتر است." }, { status: 400 });
        }
        requestedUnitPrices.set(item.invoiceItemId, unitPrice);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_CURRENCY_AMOUNT") {
          return NextResponse.json({ message: "قیمت مرجوعی معتبر نیست." }, { status: 400 });
        }
        throw error;
      }
    }
    if (refundAmount > 0n && !parsed.data.refundMethod) {
      return NextResponse.json({ message: "روش بازپرداخت را انتخاب کنید." }, { status: 400 });
    }
    if (refundAmount > 0n && parsed.data.refundMethod === "CHECK" &&
      (!parsed.data.refundCheckNumber || !parsed.data.refundCheckIssuedAt ||
        !parsed.data.refundCheckDueAt || !parsed.data.refundPayableTo)) {
      return NextResponse.json({ message: "اطلاعات کامل چک بازپرداخت را وارد کنید." }, { status: 400 });
    }
    if (parsed.data.refundCheckIssuedAt && parsed.data.refundCheckDueAt &&
      parsed.data.refundCheckDueAt < parsed.data.refundCheckIssuedAt) {
      return NextResponse.json({ message: "تاریخ سررسید چک نمی‌تواند قبل از تاریخ صدور باشد." }, { status: 400 });
    }

    const existing = await findExistingReturn(prisma, tenantId, requestKey);
    if (existing) {
      const hashRows = await prisma.$queryRaw<{ invoiceId: string; idempotencyRequestHash: string | null }[]>`
        SELECT "invoiceId", "idempotencyRequestHash"
        FROM "SalesReturn" WHERE "id" = ${existing.id} AND "businessId" = ${tenantId}
      `;
      if (existing.invoiceId !== invoiceId || hashRows[0]?.idempotencyRequestHash !== fingerprint) {
        return NextResponse.json({ message: "کلید idempotency برای درخواست دیگری استفاده شده است." }, { status: 409 });
      }
      return NextResponse.json({ salesReturn: existing, message: "این مرجوعی قبلاً ثبت شده است." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const invoiceRows = await tx.$queryRaw<{
        id: string;
        businessId: string;
        invoiceNumber: string;
        type: string;
        status: string;
        total: bigint;
        contactId: string | null;
      }[]>`
        SELECT "id", "businessId", "invoiceNumber", "type", "status", "total", "contactId"
        FROM "Invoice"
        WHERE "id" = ${invoiceId} AND "businessId" = ${businessId}
        FOR UPDATE
      `;
      const invoice = invoiceRows[0];
      if (!invoice || invoice.type !== "SALE" || invoice.status !== "ISSUED") {
        throw new Error("SALES_INVOICE_NOT_ISSUED");
      }

      const duplicate = await findExistingReturn(tx, tenantId, requestKey);
      if (duplicate) {
        const duplicateHash = await tx.$queryRaw<{ idempotencyRequestHash: string | null }[]>`
          SELECT "idempotencyRequestHash" FROM "SalesReturn"
          WHERE "id" = ${duplicate.id} AND "businessId" = ${tenantId}
        `;
        if (duplicate.invoiceId !== invoiceId || duplicateHash[0]?.idempotencyRequestHash !== fingerprint) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return duplicate;
      }

      const itemRows = await tx.$queryRaw<{
        id: string;
        productId: string;
        quantity: Prisma.Decimal;
        unitPrice: bigint;
        total: bigint;
        costedQuantity: Prisma.Decimal;
        costOfGoodsSold: bigint;
        productName: string;
        productUnit: string;
      }[]>`
        SELECT item."id", item."productId", item."quantity", item."unitPrice", item."total",
          item."costedQuantity", item."costOfGoodsSold",
          product."name" AS "productName", product."unit" AS "productUnit"
        FROM "InvoiceItem" item
        JOIN "Product" product
          ON product."id" = item."productId" AND product."businessId" = ${businessId}
        WHERE item."invoiceId" = ${invoiceId}
        ORDER BY item."id"
        FOR UPDATE OF item
      `;
      if (itemRows.length === 0) throw new Error("SALES_INVOICE_EMPTY");

      const priorRows = await tx.$queryRaw<{
        invoiceItemId: string;
        quantity: Prisma.Decimal;
        amount: bigint;
        inventoryCost: bigint;
      }[]>`
        SELECT item."invoiceItemId", item."quantity", item."amount", item."inventoryCost"
        FROM "SalesReturnItem" item
        JOIN "SalesReturn" salesReturn
          ON salesReturn."id" = item."salesReturnId"
         AND salesReturn."businessId" = item."businessId"
         AND salesReturn."invoiceId" = item."invoiceId"
        WHERE item."businessId" = ${businessId} AND item."invoiceId" = ${invoiceId}
      `;
      const priorByItem = new Map<string, { quantity: Prisma.Decimal; amount: bigint; cost: bigint }>();
      for (const row of priorRows) {
        const previous = priorByItem.get(row.invoiceItemId);
        priorByItem.set(row.invoiceItemId, {
          quantity: (previous?.quantity ?? new Prisma.Decimal(0)).add(row.quantity),
          amount: (previous?.amount ?? 0n) + row.amount,
          cost: (previous?.cost ?? 0n) + row.inventoryCost,
        });
      }

      const requested = new Map<string, Prisma.Decimal>();
      for (const item of parsed.data.items) {
        const quantity = new Prisma.Decimal(item.quantity);
        if (quantity.lessThanOrEqualTo(0)) throw new Error("INVALID_RETURN_QUANTITY");
        requested.set(item.invoiceItemId, (requested.get(item.invoiceItemId) ?? new Prisma.Decimal(0)).add(quantity));
      }
      const weights = itemRows.map((item) => item.total);
      const allocationWeights = weights.every((weight) => weight === 0n)
        ? itemRows.map((item) => BigInt(item.quantity.mul(1000).toFixed(0)))
        : weights;
      const allocatedAmounts = splitInvoiceTotal(invoice.total, allocationWeights);
      const originalById = new Map(itemRows.map((item, index) => [item.id, {
        item,
        amount: allocatedAmounts[index],
      }]));

      const returnLines: {
        invoiceItemId: string;
        productId: string;
        productName: string;
        productUnit: string;
        quantity: Prisma.Decimal;
        amount: bigint;
        inventoryCost: bigint;
      }[] = [];
      let total = 0n;

      for (const [itemId, quantity] of requested) {
        const original = originalById.get(itemId);
        if (!original) throw new Error("RETURN_ITEM_NOT_IN_INVOICE");
        const previous = priorByItem.get(itemId) ?? {
          quantity: new Prisma.Decimal(0),
          amount: 0n,
          cost: 0n,
        };
        const remainingQuantity = original.item.costedQuantity.sub(previous.quantity);
        if (remainingQuantity.lessThanOrEqualTo(0) || quantity.greaterThan(remainingQuantity)) {
          throw new Error("RETURN_QUANTITY_EXCEEDED");
        }

        const remainingAmount = original.amount - previous.amount;
        const remainingCost = original.item.costOfGoodsSold - previous.cost;
        const remainingCostedQuantity = Prisma.Decimal.max(
          original.item.costedQuantity.sub(
            Prisma.Decimal.min(previous.quantity, original.item.costedQuantity),
          ),
          0,
        );
        const returnedCostedQuantity = Prisma.Decimal.min(quantity, remainingCostedQuantity);
        const requestedUnitPrice = requestedUnitPrices.get(itemId);
        let amount: bigint;
        if (requestedUnitPrice === undefined) {
          amount = quantity.equals(remainingQuantity)
            ? remainingAmount
            : prorateAmount(remainingAmount, quantity, remainingQuantity);
        } else {
          const lineAmount = BigInt(
            quantity
              .mul(requestedUnitPrice.toString())
              .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
              .toFixed(0),
          );
          amount = lineAmount;
          if (amount > remainingAmount) throw new Error("RETURN_AMOUNT_EXCEEDED");
        }
        const inventoryCost = returnedCostedQuantity.isZero()
          ? 0n
          : returnedCostedQuantity.equals(remainingCostedQuantity)
            ? remainingCost
            : prorateAmount(remainingCost, returnedCostedQuantity, remainingCostedQuantity);
        if (amount < 0n || inventoryCost < 0n || inventoryCost > MAX_CURRENCY_RIAL) {
          throw new Error("RETURN_AMOUNT_INVALID");
        }
        returnLines.push({
          invoiceItemId: itemId,
          productId: original.item.productId,
          productName: original.item.productName,
          productUnit: original.item.productUnit,
          quantity,
          amount,
          inventoryCost,
        });
        total += amount;
      }
      if (refundAmount > total) throw new Error("REFUND_EXCEEDS_RETURN");

      const returnId = randomUUID();
      const returnNumber = `${invoice.invoiceNumber}-R-${randomUUID().slice(0, 8).toUpperCase()}`;
      await tx.$executeRaw`
        INSERT INTO "SalesReturn"
          ("id", "businessId", "invoiceId", "returnNumber", "total", "description",
           "idempotencyKey", "idempotencyRequestHash")
        VALUES (${returnId}, ${businessId}, ${invoiceId}, ${returnNumber}, ${total},
          ${parsed.data.description || null}, ${requestKey}, ${fingerprint})
      `;

      const createdItems = [];
      for (const line of returnLines) {
        const products = await tx.$queryRaw<{
          stock: Prisma.Decimal;
          inventoryValue: bigint;
          averageCost: Prisma.Decimal;
        }[]>`
          SELECT "stock", "inventoryValue", "averageCost"
          FROM "Product"
          WHERE "id" = ${line.productId} AND "businessId" = ${businessId}
          FOR UPDATE
        `;
        const product = products[0];
        if (!product) throw new Error("RETURN_PRODUCT_NOT_FOUND");
        const inventory = addInventoryStock(
          product.stock,
          product.inventoryValue,
          line.quantity,
          line.inventoryCost,
        );
        const { stock, inventoryValue } = inventory;
        if (inventoryValue < 0n || inventoryValue > MAX_CURRENCY_RIAL) {
          throw new Error("AMOUNT_OVERFLOW");
        }
        const averageCost = inventory.averageCost;
        await tx.$executeRaw`
          UPDATE "Product"
          SET "stock" = ${stock}, "inventoryValue" = ${inventoryValue},
              "averageCost" = ${averageCost}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${line.productId} AND "businessId" = ${businessId}
        `;
        const itemId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "SalesReturnItem"
            ("id", "businessId", "invoiceId", "salesReturnId", "invoiceItemId",
             "productId", "quantity", "amount", "inventoryCost")
          VALUES (${itemId}, ${businessId}, ${invoiceId}, ${returnId},
            ${line.invoiceItemId}, ${line.productId}, ${line.quantity}, ${line.amount},
            ${line.inventoryCost})
        `;
        const movementRows = await tx.$queryRaw<{
          id: string;
          businessId: string;
          productId: string;
          quantity: Prisma.Decimal;
          totalCost: bigint;
          type: string;
        }[]>`
          INSERT INTO "InventoryMovement"
            ("id", "businessId", "productId", "invoiceId", "salesReturnId", "type",
             "quantity", "totalCost", "averageCost", "description")
          VALUES (${randomUUID()}, ${businessId}, ${line.productId}, ${invoiceId}, ${returnId},
            'RETURN_IN'::"MovementType", ${line.quantity}, ${line.inventoryCost}, ${averageCost},
            ${`مرجوعی فروش ${returnNumber}`})
          RETURNING "id", "businessId", "productId", "quantity", "totalCost", "type"
        `;
        if (movementRows[0]) {
          await reconcileNegativeStockBackorders(tx, movementRows[0]);
        }
        createdItems.push({
          id: itemId,
          invoiceItemId: line.invoiceItemId,
          productId: line.productId,
          quantity: line.quantity.toString(),
          amount: line.amount.toString(),
          inventoryCost: line.inventoryCost.toString(),
          product: { name: line.productName, unit: line.productUnit },
        });
      }

      let createdPayments: ReturnPaymentRow[] = [];
      if (refundAmount > 0n) {
        const method = parsed.data.refundMethod!;
        const checkIssuedAt = parsed.data.refundCheckIssuedAt
          ? new Date(`${parsed.data.refundCheckIssuedAt}T00:00:00.000Z`)
          : null;
        const checkDueAt = parsed.data.refundCheckDueAt
          ? new Date(`${parsed.data.refundCheckDueAt}T00:00:00.000Z`)
          : null;
        const paymentId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "Payment"
            ("id", "businessId", "contactId", "salesReturnId", "type", "method", "status",
             "amount", "description", "checkNumber", "checkIssuedAt", "checkDueAt",
             "payableTo", "destinationDetails", "paidAt", "createdAt", "updatedAt")
          VALUES (${paymentId}, ${businessId}, ${invoice.contactId}, ${returnId},
            'PAYMENT'::"PaymentType", ${method}::"PaymentMethod", 'CONFIRMED'::"PaymentStatus",
            ${refundAmount}, ${parsed.data.refundDescription || `بازپرداخت مرجوعی ${returnNumber}`},
            ${method === "CHECK" ? parsed.data.refundCheckNumber ?? null : null},
            ${method === "CHECK" ? checkIssuedAt : null},
            ${method === "CHECK" ? checkDueAt : null},
            ${method === "CHECK" ? parsed.data.refundPayableTo ?? null : null},
            ${method === "CARD_TO_CARD" || method === "POS" || method === "BANK_TRANSFER"
              ? parsed.data.refundDestinationDetails ?? null
              : null},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
        createdPayments = [{
          method,
          amount: refundAmount,
          description: parsed.data.refundDescription || `بازپرداخت مرجوعی ${returnNumber}`,
          checkNumber: method === "CHECK" ? parsed.data.refundCheckNumber ?? null : null,
          checkIssuedAt: method === "CHECK" ? checkIssuedAt : null,
          checkDueAt: method === "CHECK" ? checkDueAt : null,
          payableTo: method === "CHECK" ? parsed.data.refundPayableTo ?? null : null,
          destinationDetails: method === "CARD_TO_CARD" || method === "POS" || method === "BANK_TRANSFER"
            ? parsed.data.refundDestinationDetails ?? null
            : null,
        }];
      }
      return {
        id: returnId,
        invoiceId,
        returnNumber,
        total: total.toString(),
        description: parsed.data.description || null,
        createdAt: new Date().toISOString(),
        items: createdItems,
        payments: createdPayments.map((payment) => ({
          ...payment,
          amount: payment.amount.toString(),
          checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
          checkDueAt: payment.checkDueAt?.toISOString() ?? null,
        })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ salesReturn: result, message: "مرجوعی فروش ثبت شد." }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" || error.code === "P2002") &&
      businessId && idempotencyKey && invoiceId && requestHash) {
      const existing = await findExistingReturn(prisma, businessId, idempotencyKey);
      if (existing) {
        const hashRows = await prisma.$queryRaw<{ idempotencyRequestHash: string | null }[]>`
          SELECT "idempotencyRequestHash" FROM "SalesReturn"
          WHERE "id" = ${existing.id} AND "businessId" = ${businessId}
        `;
        if (existing.invoiceId === invoiceId && hashRows[0]?.idempotencyRequestHash === requestHash) {
          return NextResponse.json({ salesReturn: existing, message: "این مرجوعی قبلاً ثبت شده است." });
        }
        return NextResponse.json({ message: "کلید idempotency برای درخواست دیگری استفاده شده است." }, { status: 409 });
      }
      return NextResponse.json({ message: "اطلاعات هم‌زمان تغییر کرده است؛ فاکتور را دوباره بارگذاری و تلاش کنید." }, { status: 409 });
    }
    const knownErrors: Record<string, { status: number; message: string }> = {
      SALES_INVOICE_NOT_ISSUED: { status: 404, message: "فاکتور فروش صادرشده پیدا نشد." },
      SALES_INVOICE_EMPTY: { status: 409, message: "فاکتور فروش قلمی برای مرجوعی ندارد." },
      INVALID_RETURN_QUANTITY: { status: 400, message: "مقدار مرجوعی باید بیشتر از صفر باشد." },
      RETURN_ITEM_NOT_IN_INVOICE: { status: 400, message: "یکی از کالاها متعلق به این فاکتور نیست." },
      RETURN_QUANTITY_EXCEEDED: { status: 409, message: "مقدار مرجوعی از مقدار فروخته‌شده یا تحویل‌شده بیشتر است." },
      RETURN_AMOUNT_EXCEEDED: { status: 409, message: "مبلغ مرجوعی از مانده مبلغ این قلم بیشتر است." },
      RETURN_PRODUCT_NOT_FOUND: { status: 404, message: "کالا پیدا نشد." },
      RETURN_AMOUNT_INVALID: { status: 409, message: "محاسبه مبلغ یا بهای تمام‌شده مرجوعی معتبر نیست." },
      REFUND_EXCEEDS_RETURN: { status: 400, message: "مبلغ بازپرداخت نمی‌تواند از مبلغ مرجوعی بیشتر باشد." },
      AMOUNT_OVERFLOW: { status: 400, message: "مبلغ از محدوده مجاز بیشتر است." },
      IDEMPOTENCY_CONFLICT: { status: 409, message: "کلید idempotency برای درخواست دیگری استفاده شده است." },
    };
    if (error instanceof Error && knownErrors[error.message]) {
      const response = knownErrors[error.message];
      return NextResponse.json({ message: response.message }, { status: response.status });
    }
    console.error("POST /api/invoices/[invoiceId]/sales-returns:", error);
    return NextResponse.json({ message: "ثبت مرجوعی فروش انجام نشد." }, { status: 500 });
  }
}
