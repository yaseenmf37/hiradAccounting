import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyInputToRial, MAX_CURRENCY_RIAL } from "@/lib/currency";

const returnSchema = z.object({
  items: z.array(z.object({
    invoiceItemId: z.string().min(1),
    quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
  })).min(1).max(100),
  refundAmount: z.string().regex(/^\d{1,18}(\.\d)?$/).default("0"),
  refundMethod: z.enum(["CASH", "CHECK", "CARD_TO_CARD", "POS"]).optional(),
  refundCheckNumber: z.string().trim().max(100).nullable().optional(),
  refundCheckIssuedAt: z.string().date().nullable().optional(),
  refundCheckDueAt: z.string().date().nullable().optional(),
  refundPayableTo: z.string().trim().max(150).nullable().optional(),
  refundDestinationDetails: z.string().trim().max(250).nullable().optional(),
  refundDescription: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().trim().min(16).max(128),
  description: z.string().trim().max(1000).nullable().optional(),
});

type RouteContext = { params: Promise<{ invoiceId: string }> };

function splitInvoiceTotal(total: bigint, weights: bigint[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal === 0n) return weights.map(() => 0n);
  const amounts = weights.map((weight) => (total * weight) / weightTotal);
  let remainder = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % amounts.length) {
    amounts[index] += 1n;
    remainder -= 1n;
  }
  return amounts;
}

function prorateAmount(amount: bigint, part: bigint, whole: bigint) {
  return (amount * part + whole / 2n) / whole;
}

export async function POST(request: Request, context: RouteContext) {
  let idempotencyKey: string | null = null;
  let requestBusinessId: string | null = null;
  let requestInvoiceId: string | null = null;
  let requestHash: string | null = null;
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    }

    const parsed = returnSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "اطلاعات مرجوعی معتبر نیست." }, { status: 400 });
    }
    const { invoiceId } = await context.params;
    const businessId = user.business.id;
    requestBusinessId = businessId;
    requestInvoiceId = invoiceId;
    idempotencyKey = parsed.data.idempotencyKey;
    requestHash = createHash("sha256")
      .update(JSON.stringify({
        invoiceId,
        items: [...parsed.data.items].sort((a, b) => a.invoiceItemId.localeCompare(b.invoiceItemId)),
        refundAmount: parsed.data.refundAmount,
        refundMethod: parsed.data.refundMethod ?? null,
        refundCheckNumber: parsed.data.refundCheckNumber ?? null,
        refundCheckIssuedAt: parsed.data.refundCheckIssuedAt ?? null,
        refundCheckDueAt: parsed.data.refundCheckDueAt ?? null,
        refundPayableTo: parsed.data.refundPayableTo ?? null,
        refundDestinationDetails: parsed.data.refundDestinationDetails ?? null,
        refundDescription: parsed.data.refundDescription ?? null,
        description: parsed.data.description ?? null,
      }))
      .digest("hex");
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
    if (refundAmount > 0n && !parsed.data.refundMethod) {
      return NextResponse.json({ message: "روش بازپرداخت را انتخاب کنید." }, { status: 400 });
    }
    if (
      refundAmount > 0n &&
      parsed.data.refundMethod === "CHECK" &&
      (!parsed.data.refundCheckNumber ||
        !parsed.data.refundCheckIssuedAt ||
        !parsed.data.refundCheckDueAt ||
        !parsed.data.refundPayableTo)
    ) {
      return NextResponse.json({ message: "اطلاعات کامل چک بازپرداخت را وارد کنید." }, { status: 400 });
    }
    if (
      parsed.data.refundCheckIssuedAt &&
      parsed.data.refundCheckDueAt &&
      parsed.data.refundCheckDueAt < parsed.data.refundCheckIssuedAt
    ) {
      return NextResponse.json({ message: "تاریخ سررسید چک نمی‌تواند قبل از تاریخ صدور باشد." }, { status: 400 });
    }

    const existingReturn = await prisma.purchaseReturn.findFirst({
      where: {
        businessId,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      include: {
        items: { include: { product: { select: { name: true, unit: true } } } },
        payments: {
          select: {
            method: true,
            amount: true,
            description: true,
            checkNumber: true,
            checkIssuedAt: true,
            checkDueAt: true,
            payableTo: true,
            destinationDetails: true,
          },
        },
      },
    });
    if (existingReturn) {
      if (
        existingReturn.invoiceId !== invoiceId ||
        existingReturn.idempotencyRequestHash !== requestHash
      ) {
        return NextResponse.json({ message: "کلید idempotency برای درخواست دیگری استفاده شده است." }, { status: 409 });
      }
      return NextResponse.json({
        purchaseReturn: serializePurchaseReturn(existingReturn),
        message: "این مرجوعی قبلاً ثبت شده است.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, businessId, type: "PURCHASE", status: "ISSUED" },
        include: {
          items: { orderBy: { id: "asc" } },
          purchaseReturns: { include: { items: true } },
        },
      });
      if (!invoice) throw new Error("PURCHASE_INVOICE_NOT_FOUND");

      const requested = new Map<string, Prisma.Decimal>();
      for (const item of parsed.data.items) {
        const quantity = new Prisma.Decimal(item.quantity);
        if (quantity.lessThanOrEqualTo(0)) throw new Error("INVALID_RETURN_QUANTITY");
        requested.set(item.invoiceItemId, (requested.get(item.invoiceItemId) ?? new Prisma.Decimal(0)).add(quantity));
      }

      const returnedByItem = new Map<string, { quantity: Prisma.Decimal; amount: bigint }>();
      for (const purchaseReturn of invoice.purchaseReturns) {
        for (const item of purchaseReturn.items) {
          const previous = returnedByItem.get(item.invoiceItemId);
          returnedByItem.set(item.invoiceItemId, {
            quantity: (previous?.quantity ?? new Prisma.Decimal(0)).add(item.quantity),
            amount: (previous?.amount ?? 0n) + item.amount,
          });
        }
      }

      const weights = invoice.items.map((item) => item.total);
      const allocationWeights = weights.every((weight) => weight === 0n)
        ? invoice.items.map((item) => BigInt(item.quantity.mul(1000).toFixed(0)))
        : weights;
      const allocatedAmounts = splitInvoiceTotal(invoice.total, allocationWeights);
      const originalById = new Map(invoice.items.map((item, index) => [item.id, {
        item,
        amount: allocatedAmounts[index],
      }]));

      const returnLines: {
        invoiceItemId: string;
        productId: string;
        quantity: Prisma.Decimal;
        amount: bigint;
        inventoryCost: bigint;
      }[] = [];
      let total = 0n;

      for (const [invoiceItemId, quantity] of requested) {
        const original = originalById.get(invoiceItemId);
        if (!original) throw new Error("RETURN_ITEM_NOT_IN_INVOICE");
        const previous = returnedByItem.get(invoiceItemId);
        const alreadyReturned = previous?.quantity ?? new Prisma.Decimal(0);
        const remaining = original.item.quantity.sub(alreadyReturned);
        if (quantity.greaterThan(remaining)) throw new Error("RETURN_QUANTITY_EXCEEDED");

        const remainingAmount = original.amount - (previous?.amount ?? 0n);
        const amount = quantity.equals(remaining)
          ? remainingAmount
          : prorateAmount(
              remainingAmount,
              BigInt(quantity.mul(1000).toFixed(0)),
              BigInt(remaining.mul(1000).toFixed(0)),
            );
        if (amount < 0n) throw new Error("RETURN_AMOUNT_INVALID");

        const product = await tx.product.findFirst({
          where: { id: original.item.productId, businessId, isActive: true },
          select: { id: true, stock: true, inventoryValue: true, averageCost: true },
        });
        if (!product || product.stock.lessThan(quantity)) {
          throw new Error("RETURN_STOCK_INSUFFICIENT");
        }
        let inventoryCost = BigInt(
          product.averageCost
            .mul(quantity)
            .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(0),
        );
        if (inventoryCost > product.inventoryValue) inventoryCost = product.inventoryValue;
        const stock = product.stock.sub(quantity);
        const inventoryValue = product.inventoryValue - inventoryCost;
        const updated = await tx.product.updateMany({
          where: {
            id: product.id,
            businessId,
            stock: product.stock,
            inventoryValue: product.inventoryValue,
            averageCost: product.averageCost,
          },
          data: {
            stock,
            inventoryValue,
            averageCost: stock.greaterThan(0)
              ? new Prisma.Decimal(inventoryValue.toString()).div(stock)
              : new Prisma.Decimal(0),
          },
        });
        if (updated.count !== 1) throw new Error("STOCK_CONFLICT");

        returnLines.push({
          invoiceItemId,
          productId: original.item.productId,
          quantity,
          amount,
          inventoryCost,
        });
        total += amount;
      }

      if (refundAmount > total) throw new Error("REFUND_EXCEEDS_RETURN");
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          businessId,
          invoiceId: invoice.id,
          returnNumber: `${invoice.invoiceNumber}-R-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          idempotencyKey: parsed.data.idempotencyKey,
          idempotencyRequestHash: requestHash,
          total,
          description: parsed.data.description || null,
          items: { create: returnLines },
        },
      });

      for (const line of returnLines) {
        const product = await tx.product.findFirstOrThrow({
          where: { id: line.productId, businessId },
          select: { averageCost: true },
        });
        await tx.inventoryMovement.create({
          data: {
            businessId,
            productId: line.productId,
            invoiceId: invoice.id,
            purchaseReturnId: purchaseReturn.id,
            type: "RETURN_OUT",
            quantity: line.quantity,
            totalCost: line.inventoryCost,
            averageCost: product.averageCost,
            description: `مرجوعی خرید ${purchaseReturn.returnNumber}`,
          },
        });
      }

      if (refundAmount > 0n) {
        await tx.payment.create({
          data: {
            businessId,
            contactId: invoice.contactId,
            purchaseReturnId: purchaseReturn.id,
            type: "RECEIPT",
            method: parsed.data.refundMethod!,
            status: "CONFIRMED",
            amount: refundAmount,
            description: parsed.data.refundDescription || `بازپرداخت مرجوعی ${purchaseReturn.returnNumber}`,
            checkNumber: parsed.data.refundMethod === "CHECK"
              ? parsed.data.refundCheckNumber
              : null,
            checkIssuedAt: parsed.data.refundCheckIssuedAt
              ? new Date(`${parsed.data.refundCheckIssuedAt}T00:00:00.000Z`)
              : null,
            checkDueAt: parsed.data.refundCheckDueAt
              ? new Date(`${parsed.data.refundCheckDueAt}T00:00:00.000Z`)
              : null,
            payableTo: parsed.data.refundMethod === "CHECK"
              ? parsed.data.refundPayableTo
              : null,
            destinationDetails: parsed.data.refundMethod === "CARD_TO_CARD" || parsed.data.refundMethod === "POS"
              ? parsed.data.refundDestinationDetails
              : null,
          },
        });
      }

      return tx.purchaseReturn.findUniqueOrThrow({
        where: { id: purchaseReturn.id },
        include: {
          items: { include: { product: { select: { name: true, unit: true } } } },
          payments: {
            select: {
              method: true,
              amount: true,
              description: true,
              checkNumber: true,
              checkIssuedAt: true,
              checkDueAt: true,
              payableTo: true,
              destinationDetails: true,
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({
      purchaseReturn: serializePurchaseReturn(result),
      message: "مرجوعی خرید ثبت شد.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      const existing = idempotencyKey && requestBusinessId
        ? await prisma.purchaseReturn.findFirst({
            where: { businessId: requestBusinessId, idempotencyKey },
            include: {
              items: { include: { product: { select: { name: true, unit: true } } } },
              payments: {
                select: {
                  method: true,
                  amount: true,
                  description: true,
                  checkNumber: true,
                  checkIssuedAt: true,
                  checkDueAt: true,
                  payableTo: true,
                  destinationDetails: true,
                },
              },
            },
          })
        : null;
      if (existing) {
        if (existing.invoiceId !== requestInvoiceId || existing.idempotencyRequestHash !== requestHash) {
          return NextResponse.json({ message: "کلید idempotency برای درخواست دیگری استفاده شده است." }, { status: 409 });
        }
        return NextResponse.json({
          purchaseReturn: serializePurchaseReturn(existing),
          message: "این مرجوعی قبلاً ثبت شده است.",
        });
      }
      return NextResponse.json(
        { message: "اطلاعات هم‌زمان تغییر کرده است؛ فاکتور را دوباره بارگذاری و تلاش کنید." },
        { status: 409 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = idempotencyKey && requestBusinessId
        ? await prisma.purchaseReturn.findFirst({
            where: { businessId: requestBusinessId, idempotencyKey },
            include: {
              items: { include: { product: { select: { name: true, unit: true } } } },
              payments: {
                select: {
                  method: true,
                  amount: true,
                  description: true,
                  checkNumber: true,
                  checkIssuedAt: true,
                  checkDueAt: true,
                  payableTo: true,
                  destinationDetails: true,
                },
              },
            },
          })
        : null;
      if (existing) {
        if (existing.invoiceId !== requestInvoiceId || existing.idempotencyRequestHash !== requestHash) {
          return NextResponse.json({ message: "کلید idempotency برای درخواست دیگری استفاده شده است." }, { status: 409 });
        }
        return NextResponse.json({
          purchaseReturn: serializePurchaseReturn(existing),
          message: "این مرجوعی قبلاً ثبت شده است.",
        });
      }
    }
    const messages: Record<string, { status: number; message: string }> = {
      PURCHASE_INVOICE_NOT_FOUND: { status: 404, message: "فاکتور خرید صادرشده پیدا نشد." },
      INVALID_RETURN_QUANTITY: { status: 400, message: "مقدار مرجوعی باید بیشتر از صفر باشد." },
      RETURN_ITEM_NOT_IN_INVOICE: { status: 400, message: "یکی از کالاها متعلق به این فاکتور نیست." },
      RETURN_QUANTITY_EXCEEDED: { status: 409, message: "مقدار مرجوعی از مقدار باقی‌مانده بیشتر است." },
      RETURN_AMOUNT_INVALID: { status: 409, message: "محاسبه مبلغ مرجوعی معتبر نیست." },
      RETURN_STOCK_INSUFFICIENT: { status: 409, message: "موجودی فعلی برای ثبت این مرجوعی کافی نیست." },
      STOCK_CONFLICT: { status: 409, message: "موجودی هم‌زمان تغییر کرده است؛ دوباره تلاش کنید." },
      REFUND_EXCEEDS_RETURN: { status: 400, message: "مبلغ بازپرداخت نمی‌تواند از مبلغ مرجوعی بیشتر باشد." },
    };
    if (error instanceof Error && error.message in messages) {
      const response = messages[error.message];
      return NextResponse.json({ message: response.message }, { status: response.status });
    }
    console.error("POST /api/invoices/[invoiceId]/returns:", error);
    return NextResponse.json({ message: "ثبت مرجوعی خرید انجام نشد." }, { status: 500 });
  }
}

function serializePurchaseReturn<
  T extends {
    total: bigint;
    items: {
      quantity: Prisma.Decimal;
      amount: bigint;
      inventoryCost: bigint;
    }[];
    payments: {
      amount: bigint;
      checkIssuedAt?: Date | null;
      checkDueAt?: Date | null;
    }[];
  },
>(purchaseReturn: T) {
  return {
    ...purchaseReturn,
    total: purchaseReturn.total.toString(),
    items: purchaseReturn.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      amount: item.amount.toString(),
      inventoryCost: item.inventoryCost.toString(),
    })),
    payments: purchaseReturn.payments.map((payment) => ({
      ...payment,
      amount: payment.amount.toString(),
      checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
      checkDueAt: payment.checkDueAt?.toISOString() ?? null,
    })),
  };
}
