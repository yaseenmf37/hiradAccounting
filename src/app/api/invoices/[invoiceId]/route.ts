
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyInputToRial, MAX_CURRENCY_RIAL } from "@/lib/currency";
import { addInventoryStock, reconcileNegativeStockBackorders } from "@/lib/inventory";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

const amountSchema = z.string().regex(/^\d{1,18}(\.\d)?$/);
const expectedPaymentMethods = ["CASH", "CHECK", "CARD_TO_CARD", "POS"] as const;

const invoiceSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"]),
  invoiceDate: z.string().date().optional(),
  contactId: z.string().nullable().optional(),
  contactSnapshot: z.object({
    name: z.string().trim().min(2).max(150),
    phone: z.string().trim().max(30).nullable().optional(),
    address: z.string().trim().max(1000).nullable().optional(),
  }).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  reference: z.string().trim().max(150).nullable().optional(),
  referenceNumber: z.string().trim().max(100).nullable().optional(),
  extraCosts: amountSchema.default("0"),
  discount: amountSchema.default("0"),
  discountPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).nullable().optional(),
  payments: z.array(z.object({
    method: z.enum(["CASH", "CHECK", "CARD_TO_CARD", "POS", "LEDGER"]),
    amount: amountSchema,
    description: z.string().trim().max(1000).nullable().optional(),
    checkNumber: z.string().trim().max(100).nullable().optional(),
    checkIssuedAt: z.string().date().nullable().optional(),
    checkDueAt: z.string().date().nullable().optional(),
    payableTo: z.string().trim().max(150).nullable().optional(),
    destinationDetails: z.string().trim().max(300).nullable().optional(),
  })).max(5).default([]),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
      unitPrice: amountSchema,
    })
  ).min(1).max(100),
});

function allocateAmount(amount: bigint, weights: bigint[]) {
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

function authorize(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) {
    return {
      error: NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      error: NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      ),
    };
  }

  return { businessId: user.business.id };
}


function serializeInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  subtotal: bigint;
  extraCosts: bigint;
  discount: bigint;
  total: bigint;
  description: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  contact: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
  } | null;
  business?: { name: string; phone: string | null };
  payments?: {
    allocationBatchId?: string | null;
    method: string;
    amount: bigint;
    description: string | null;
    status?: string;
    checkNumber?: string | null;
    checkIssuedAt?: Date | null;
    checkDueAt?: Date | null;
    checkClearedAt?: Date | null;
    payableTo?: string | null;
    destinationDetails?: string | null;
  }[];
  contactNameSnapshot?: string | null;
  contactPhoneSnapshot?: string | null;
  contactAddressSnapshot?: string | null;
  items: {
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: bigint;
    total: bigint;
    costOfGoodsSold: bigint;
    costedQuantity: Prisma.Decimal;
    product: { name: string; unit: string };
  }[];
  purchaseReturns?: {
    id: string;
    returnNumber: string;
    total: bigint;
    description: string | null;
    createdAt: Date;
    items: {
      id: string;
      invoiceItemId: string;
      productId: string;
      quantity: Prisma.Decimal;
      amount: bigint;
      inventoryCost: bigint;
      product: { name: string; unit: string };
    }[];
    payments: {
      method: string;
      amount: bigint;
      description: string | null;
      checkNumber?: string | null;
      checkIssuedAt?: Date | null;
      checkDueAt?: Date | null;
      payableTo?: string | null;
      destinationDetails?: string | null;
    }[];
  }[];
  salesReturns?: {
    id: string;
    returnNumber: string;
    total: bigint;
    description: string | null;
    createdAt: Date;
    items: {
      id: string;
      invoiceItemId: string;
      productId: string;
      quantity: Prisma.Decimal;
      amount: bigint;
      inventoryCost: bigint;
      product: { name: string; unit: string };
    }[];
    payments: {
      method: string;
      amount: bigint;
      description: string | null;
      checkNumber: string | null;
      checkIssuedAt: Date | null;
      checkDueAt: Date | null;
      checkClearedAt: Date | null;
      payableTo: string | null;
      destinationDetails: string | null;
    }[];
  }[];
}) {
  return {
    ...invoice,
    subtotal: invoice.subtotal.toString(),
    extraCosts: invoice.extraCosts.toString(),
    discount: invoice.discount.toString(),
    total: invoice.total.toString(),
    payments: invoice.payments?.map((payment) => ({
      ...payment,
      amount: payment.amount.toString(),
      checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
      checkDueAt: payment.checkDueAt?.toISOString() ?? null,
      checkClearedAt: payment.checkClearedAt?.toISOString() ?? null,
    })),
    purchaseReturns: invoice.purchaseReturns?.map((purchaseReturn) => ({
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
      })),
    })),
    salesReturns: invoice.salesReturns?.map((salesReturn) => ({
      ...salesReturn,
      total: salesReturn.total.toString(),
      items: salesReturn.items.map((item) => ({
        ...item,
        quantity: item.quantity.toString(),
        amount: item.amount.toString(),
        inventoryCost: item.inventoryCost.toString(),
      })),
      payments: salesReturn.payments.map((payment) => ({
        ...payment,
        amount: payment.amount.toString(),
        checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
        checkDueAt: payment.checkDueAt?.toISOString() ?? null,
        checkClearedAt: payment.checkClearedAt?.toISOString() ?? null,
      })),
    })),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
      costOfGoodsSold: item.costOfGoodsSold.toString(),
      costedQuantity: item.costedQuantity.toString(),
    })),
  };
}


// مشاهده جزئیات فاکتور
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        businessId: auth.businessId,
      },
      include: {
        contact: {
          select: { id: true, name: true, phone: true, address: true },
        },
        business: {
          select: { name: true, phone: true },
        },
        payments: {
          where: { status: { in: ["CONFIRMED", "PENDING"] } },
          select: {
            method: true, amount: true, description: true, status: true,
            checkNumber: true, checkIssuedAt: true, checkDueAt: true,
            checkClearedAt: true,
            payableTo: true, destinationDetails: true,
            allocationBatchId: true,
          },
          orderBy: { paidAt: "asc" },
        },
        purchaseReturns: {
          orderBy: { createdAt: "desc" },
          include: {
            items: {
              include: { product: { select: { name: true, unit: true } } },
            },
            payments: {
              where: { status: "CONFIRMED" },
              select: {
                method: true,
                amount: true,
                description: true,
                checkNumber: true,
                checkIssuedAt: true,
                checkDueAt: true,
                checkClearedAt: true,
                payableTo: true,
                destinationDetails: true,
              },
            },
          },
        },
        items: {
          include: {
            product: {
              select: { name: true, unit: true },
            },
          },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { message: "فاکتور پیدا نشد." },
        { status: 404 }
      );
    }

    const salesReturnRows = await prisma.$queryRaw<{
      id: string;
      returnNumber: string;
      total: bigint;
      description: string | null;
      createdAt: Date;
    }[]>`
      SELECT "id", "returnNumber", "total", "description", "createdAt"
      FROM "SalesReturn"
      WHERE "invoiceId" = ${invoiceId} AND "businessId" = ${auth.businessId}
      ORDER BY "createdAt" DESC, "id" DESC
    `;
    const salesReturnIds = salesReturnRows.map((salesReturn) => salesReturn.id);
    const [salesReturnItems, salesReturnPayments] = salesReturnIds.length > 0
      ? await Promise.all([
          prisma.$queryRaw<{
            id: string;
            salesReturnId: string;
            invoiceItemId: string;
            productId: string;
            quantity: Prisma.Decimal;
            amount: bigint;
            inventoryCost: bigint;
            productName: string;
            productUnit: string;
          }[]>`
            SELECT item."id", item."salesReturnId", item."invoiceItemId", item."productId",
              item."quantity", item."amount", item."inventoryCost",
              product."name" AS "productName", product."unit" AS "productUnit"
            FROM "SalesReturnItem" item
            JOIN "Product" product
              ON product."id" = item."productId" AND product."businessId" = ${auth.businessId}
            WHERE item."businessId" = ${auth.businessId}
              AND item."invoiceId" = ${invoiceId}
              AND item."salesReturnId" IN (${Prisma.join(salesReturnIds)})
            ORDER BY item."id"
          `,
          prisma.$queryRaw<{
            salesReturnId: string;
            method: string;
            amount: bigint;
            description: string | null;
            checkNumber: string | null;
            checkIssuedAt: Date | null;
            checkDueAt: Date | null;
            checkClearedAt: Date | null;
            payableTo: string | null;
            destinationDetails: string | null;
          }[]>`
            SELECT payment."salesReturnId", payment."method", payment."amount",
              payment."description", payment."checkNumber", payment."checkIssuedAt",
              payment."checkDueAt", payment."checkClearedAt",
              payment."payableTo", payment."destinationDetails"
            FROM "Payment" payment
            WHERE payment."businessId" = ${auth.businessId}
              AND payment."salesReturnId" IN (${Prisma.join(salesReturnIds)})
              AND payment."status" = 'CONFIRMED'::"PaymentStatus"
            ORDER BY payment."paidAt", payment."id"
          `,
        ])
      : [[], []];
    const invoiceWithSalesReturns = {
      ...invoice,
      salesReturns: salesReturnRows.map((salesReturn) => ({
        ...salesReturn,
        items: salesReturnItems
          .filter((item) => item.salesReturnId === salesReturn.id)
          .map((item) => ({
            id: item.id,
            invoiceItemId: item.invoiceItemId,
            productId: item.productId,
            quantity: item.quantity,
            amount: item.amount,
            inventoryCost: item.inventoryCost,
            product: { name: item.productName, unit: item.productUnit },
          })),
        payments: salesReturnPayments.filter((payment) => payment.salesReturnId === salesReturn.id),
      })),
    };

    return NextResponse.json({
      invoice: serializeInvoice(invoiceWithSalesReturns),
    });
  } catch (error) {
    console.error("Get invoice error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت اطلاعات فاکتور." },
      { status: 500 }
    );
  }
}

// ویرایش پیش‌نویس
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const body = await request.json();
    const validation = invoiceSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات فاکتور معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const businessId = auth.businessId;

    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          businessId,
        },
        include: {
          items: true,
          backorders: true,
          purchaseReturns: { select: { id: true } },
          movements: true,
          payments: {
            where: { status: { in: ["CONFIRMED", "PENDING"] } },
            select: {
              id: true,
              amount: true,
              method: true,
              status: true,
              allocationBatchId: true,
              paidAt: true,
              description: true,
              checkNumber: true,
              checkIssuedAt: true,
              checkDueAt: true,
              checkClearedAt: true,
              payableTo: true,
              destinationDetails: true,
            },
          },
        },
      });

      if (!existing) {
        throw new Error("INVOICE_NOT_FOUND");
      }

      const editingIssuedSale = existing.status === "ISSUED" && existing.type === "SALE";
      const editingIssuedPurchase =
        existing.status === "ISSUED" && existing.type === "PURCHASE";
      const editingIssuedInvoice = editingIssuedSale || editingIssuedPurchase;
      if (editingIssuedSale) {
        const salesReturns = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count
          FROM "SalesReturn"
          WHERE "invoiceId" = ${existing.id} AND "businessId" = ${businessId}
        `;
        if ((salesReturns[0]?.count ?? 0n) > 0n) {
          throw new Error("SALE_HAS_RETURNS");
        }
      }
      if (existing.status !== "DRAFT" && !editingIssuedInvoice) {
        throw new Error("INVOICE_NOT_EDITABLE");
      }
      if (editingIssuedInvoice && data.type !== existing.type) {
        throw new Error("ISSUED_TYPE_IMMUTABLE");
      }
      if (editingIssuedInvoice) {
        const snapshotValue = (value: string | null | undefined) => value?.trim() || null;
        const snapshotChanged = !existing.contactId && (
          snapshotValue(data.contactSnapshot?.name) !== existing.contactNameSnapshot ||
          snapshotValue(data.contactSnapshot?.phone) !== existing.contactPhoneSnapshot ||
          snapshotValue(data.contactSnapshot?.address) !== existing.contactAddressSnapshot
        );
        if ((data.contactId || null) !== existing.contactId || snapshotChanged) {
          throw new Error("ISSUED_CONTACT_IMMUTABLE");
        }
      }
      if (
        data.payments.length < expectedPaymentMethods.length ||
        data.payments.length > expectedPaymentMethods.length + 1 ||
        new Set(data.payments.map((payment) => payment.method)).size !== data.payments.length ||
        !expectedPaymentMethods.every((method) => data.payments.some((payment) => payment.method === method))
      ) {
        throw new Error("PAYMENT_METHODS_REQUIRED");
      }
      if (data.payments.some((payment) =>
        payment.checkIssuedAt &&
        payment.checkDueAt &&
        payment.checkDueAt < payment.checkIssuedAt
      )) {
        throw new Error("CHECK_DUE_BEFORE_ISSUE");
      }

      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { currencyUnit: true },
      });

      if (!business) {
        throw new Error("BUSINESS_NOT_FOUND");
      }

      const productIds = [
        ...new Set(data.items.map((item) => item.productId)),
      ];

      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          businessId,
          isActive: true,
        },
        select: { id: true },
      });

      if (products.length !== productIds.length) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      if (data.contactId) {
        const contact = await tx.contact.findFirst({
          where: {
            id: data.contactId,
            businessId,
            isActive: true,
            ...(data.type === "SALE"
              ? { type: { in: ["CUSTOMER", "BOTH"] } }
              : { type: { in: ["SUPPLIER", "BOTH"] } }),
          },
          select: { id: true },
        });

        if (!contact) {
          throw new Error("CONTACT_NOT_FOUND");
        }
      }
      if (data.type === "SALE" && !data.contactId && !data.contactSnapshot) {
        throw new Error("CUSTOMER_REQUIRED");
      }
      const contactSnapshot = data.contactId
        ? await tx.contact.findFirst({
            where: { id: data.contactId, businessId },
            select: { name: true, phone: true, address: true },
          })
        : data.contactSnapshot;

      const extraCosts = currencyInputToRial(data.extraCosts, business.currencyUnit);

      const items = data.items.map((item) => {
        const quantity = new Prisma.Decimal(item.quantity);

        if (quantity.lessThanOrEqualTo(0)) {
          throw new Error("INVALID_QUANTITY");
        }

        const unitPrice = currencyInputToRial(item.unitPrice, business.currencyUnit);

        const total = BigInt(
          quantity
            .mul(unitPrice.toString())
            .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(0)
        );
        if (total > MAX_CURRENCY_RIAL) {
          throw new Error("AMOUNT_OVERFLOW");
        }

        return {
          productId: item.productId,
          quantity,
          unitPrice,
          total,
        };
      });

      const subtotal = items.reduce(
        (sum, item) => sum + item.total,
        BigInt(0)
      );
      if (subtotal > MAX_CURRENCY_RIAL || subtotal + extraCosts > MAX_CURRENCY_RIAL) {
        throw new Error("AMOUNT_OVERFLOW");
      }

      const discountPercent = data.discountPercent === undefined || data.discountPercent === null
        ? null
        : new Prisma.Decimal(data.discountPercent);
      if (discountPercent && (discountPercent.lessThan(0) || discountPercent.greaterThan(100))) {
        throw new Error("INVALID_DISCOUNT_PERCENT");
      }
      const discountBase = subtotal;
      const discount = discountPercent
        ? BigInt(new Prisma.Decimal(discountBase.toString())
            .mul(discountPercent)
            .div(100)
            .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(0))
        : currencyInputToRial(data.discount, business.currencyUnit);
      if (discount > discountBase) {
        throw new Error("INVALID_DISCOUNT");
      }

      const total = subtotal + extraCosts - discount;
      const requestedPaymentTotal = data.payments.reduce(
        (sum, payment) => payment.method === "LEDGER"
          ? sum
          : sum + currencyInputToRial(payment.amount, business.currencyUnit),
        0n,
      );
      if (requestedPaymentTotal > total) {
        throw new Error("PAYMENTS_OVER_TOTAL");
      }
      const ledgerAmount = total - requestedPaymentTotal;
      const immediatelyPaidTotal = data.payments.reduce(
        (sum, payment) => payment.method === "LEDGER" || payment.method === "CHECK"
          ? sum
          : sum + currencyInputToRial(payment.amount, business.currencyUnit),
        0n,
      );
      if (data.type === "SALE" && !data.contactId && immediatelyPaidTotal < total) {
        throw new Error("CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT");
      }
      if (editingIssuedInvoice) {
        const confirmedAmount = existing.payments.reduce(
          (sum, payment) => payment.status === "CONFIRMED" &&
            payment.method !== "LEDGER" &&
            (payment.method !== "CHECK" || payment.checkClearedAt !== null)
            ? sum + payment.amount
            : sum,
          0n,
        );
        if (confirmedAmount > total) {
          throw new Error("TOTAL_BELOW_CONFIRMED_PAYMENTS");
        }
        if (existing.payments.some((payment) => payment.status !== "CONFIRMED")) {
          throw new Error("INVOICE_PAYMENT_STATE_UNSAFE");
        }
        if (existing.payments.some((payment) => payment.checkClearedAt !== null)) {
          throw new Error("INVOICE_CLEARED_CHECKS_PRESENT");
        }
        if (existing.payments.length > 0) {
          const currentBatchId = existing.payments[0].allocationBatchId;
          if (
            !existing.paymentPlanRecorded ||
            !currentBatchId ||
            existing.payments.some((payment) => payment.allocationBatchId !== currentBatchId)
          ) {
            throw new Error("INVOICE_EXTERNAL_PAYMENTS_PRESENT");
          }
        }
      }

      const replaceIssuedAllocations = async () => {
        if (!editingIssuedInvoice) return null;
        const current = existing.payments;
        const batchId = current[0]?.allocationBatchId;
        const before = current.map((payment) => ({
          id: payment.id,
          method: payment.method,
          amount: payment.amount.toString(),
          status: payment.status,
          description: payment.description,
          paidAt: payment.paidAt.toISOString(),
          checkNumber: payment.checkNumber,
          checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
          checkDueAt: payment.checkDueAt?.toISOString() ?? null,
          checkClearedAt: payment.checkClearedAt?.toISOString() ?? null,
          payableTo: payment.payableTo,
          destinationDetails: payment.destinationDetails,
        }));
        const replacementBatchId = crypto.randomUUID();
        const replacementDate = current[0]?.paidAt ?? existing.issuedAt ?? new Date();
        if (current.length > 0 && batchId) {
          const cancelled = await tx.payment.updateMany({
            where: {
              id: { in: current.map((payment) => payment.id) },
              businessId,
              invoiceId: existing.id,
              status: "CONFIRMED",
              allocationBatchId: batchId,
            },
            data: {
              status: "CANCELLED",
              cancelledAt: new Date(),
              cancelReason: "تخصیص پرداخت با ویرایش فاکتور جایگزین شد.",
            },
          });
          if (cancelled.count !== current.length) {
            throw new Error("PAYMENT_PLAN_CONFLICT");
          }
        }
        const after = [];
        for (const payment of data.payments) {
          const amount = payment.method === "LEDGER"
            ? ledgerAmount
            : currencyInputToRial(payment.amount, business.currencyUnit);
          if (amount === 0n) continue;
          const created = await tx.payment.create({
            data: {
              businessId,
              contactId: existing.contactId,
              invoiceId: existing.id,
              allocationBatchId: replacementBatchId,
              type: existing.type === "SALE" ? "RECEIPT" : "PAYMENT",
              method: payment.method,
              status: "CONFIRMED",
              amount,
              paidAt: replacementDate,
              description: payment.description || null,
              trackingNumber: payment.method === "CHECK" ? payment.checkNumber || null : null,
              checkNumber: payment.method === "CHECK" ? payment.checkNumber || null : null,
              checkIssuedAt: payment.method === "CHECK" && payment.checkIssuedAt
                ? new Date(`${payment.checkIssuedAt}T00:00:00.000Z`)
                : null,
              checkDueAt: payment.method === "CHECK" && payment.checkDueAt
                ? new Date(`${payment.checkDueAt}T00:00:00.000Z`)
                : null,
              payableTo: payment.method === "CHECK" ? payment.payableTo || null : null,
              destinationDetails:
                payment.method === "CARD_TO_CARD" || payment.method === "POS"
                  ? payment.destinationDetails || null
                  : null,
            },
          });
          after.push({
            id: created.id,
            method: created.method,
            amount: created.amount.toString(),
            status: created.status,
            description: created.description,
            paidAt: created.paidAt.toISOString(),
            checkNumber: created.checkNumber,
            checkIssuedAt: created.checkIssuedAt?.toISOString() ?? null,
            checkDueAt: created.checkDueAt?.toISOString() ?? null,
            payableTo: created.payableTo,
            destinationDetails: created.destinationDetails,
          });
        }
        return { before, after };
      };

      if (editingIssuedPurchase) {
        if (
          existing.backorders.length > 0 ||
          existing.purchaseReturns.length > 0 ||
          !existing.issuedAt
        ) {
          throw new Error("PURCHASE_HISTORY_UNSAFE");
        }

        const beforeByProduct = new Map<string, Prisma.Decimal>();
        const beforeCostByProduct = new Map<string, bigint>();
        const invoiceQuantities = new Map<string, Prisma.Decimal>();
        for (const item of existing.items) {
          invoiceQuantities.set(
            item.productId,
            (invoiceQuantities.get(item.productId) ?? new Prisma.Decimal(0)).add(item.quantity),
          );
        }
        for (const movement of existing.movements) {
          if (movement.type !== "PURCHASE" && movement.type !== "RETURN_OUT") continue;
          const sign = movement.type === "PURCHASE" ? 1 : -1;
          beforeByProduct.set(
            movement.productId,
            (beforeByProduct.get(movement.productId) ?? new Prisma.Decimal(0))
              .add(movement.quantity.mul(sign)),
          );
          beforeCostByProduct.set(
            movement.productId,
            (beforeCostByProduct.get(movement.productId) ?? 0n) +
              (sign === 1 ? movement.totalCost : -movement.totalCost),
          );
        }
        for (const productId of new Set([
          ...invoiceQuantities.keys(),
          ...beforeByProduct.keys(),
        ])) {
          const invoiceQuantity =
            invoiceQuantities.get(productId) ?? new Prisma.Decimal(0);
          if (
            !invoiceQuantity.equals(
              beforeByProduct.get(productId) ?? new Prisma.Decimal(0),
            )
          ) {
            throw new Error("PURCHASE_HISTORY_UNSAFE");
          }
        }

        const allocation = allocateAmount(
          subtotal + extraCosts - discount,
          items.map((item) => item.total),
        );
        const afterByProduct = new Map<string, Prisma.Decimal>();
        const afterCostByProduct = new Map<string, bigint>();
        const itemCosts = new Map<string, bigint>();
        items.forEach((item, index) => {
          afterByProduct.set(
            item.productId,
            (afterByProduct.get(item.productId) ?? new Prisma.Decimal(0)).add(item.quantity),
          );
          afterCostByProduct.set(
            item.productId,
            (afterCostByProduct.get(item.productId) ?? 0n) + allocation[index],
          );
          itemCosts.set(`${item.productId}:${index}`, allocation[index]);
        });

        const productIds = new Set([
          ...beforeByProduct.keys(),
          ...afterByProduct.keys(),
        ]);
        for (const productId of productIds) {
          const sourceMovements = existing.movements.filter(
            (movement) => movement.productId === productId,
          );
          const firstSourceMovement = sourceMovements.reduce<Date | null>(
            (earliest, movement) =>
              !earliest || movement.createdAt < earliest
                ? movement.createdAt
                : earliest,
            null,
          );
          const laterMovement = await tx.inventoryMovement.findFirst({
            where: {
              businessId,
              productId,
              invoiceId: { not: existing.id },
              createdAt: { gte: firstSourceMovement ?? existing.issuedAt },
            },
            select: { id: true },
          });
          if (laterMovement) throw new Error("PURCHASE_HISTORY_UNSAFE");

          const oldQuantity = beforeByProduct.get(productId) ?? new Prisma.Decimal(0);
          const oldCost = beforeCostByProduct.get(productId) ?? 0n;
          if (oldQuantity.greaterThan(0) && sourceMovements.length === 0) {
            throw new Error("PURCHASE_HISTORY_UNSAFE");
          }
          const newQuantity = afterByProduct.get(productId) ?? new Prisma.Decimal(0);
          const newCost = afterCostByProduct.get(productId) ?? 0n;
          const product = await tx.product.findFirst({
            where: { id: productId, businessId, isActive: true },
            select: { id: true, stock: true, inventoryValue: true, averageCost: true },
          });
          if (!product) throw new Error("PRODUCT_NOT_FOUND");
          if (
            product.stock.lessThan(oldQuantity) ||
            product.inventoryValue < oldCost
          ) {
            throw new Error("PURCHASE_HISTORY_UNSAFE");
          }
          const newStock = product.stock.sub(oldQuantity).add(newQuantity);
          const newInventoryValue = product.inventoryValue - oldCost + newCost;
          if (
            newStock.lessThan(0) ||
            newInventoryValue < 0n ||
            newInventoryValue > MAX_CURRENCY_RIAL
          ) {
            throw new Error("PURCHASE_HISTORY_UNSAFE");
          }
          const updated = await tx.product.updateMany({
            where: {
              id: product.id,
              businessId,
              stock: product.stock,
              inventoryValue: product.inventoryValue,
              averageCost: product.averageCost,
            },
            data: {
              stock: newStock,
              inventoryValue: newInventoryValue,
              averageCost: newStock.greaterThan(0)
                ? new Prisma.Decimal(newInventoryValue.toString()).div(newStock)
                : new Prisma.Decimal(0),
            },
          });
          if (updated.count !== 1) throw new Error("STOCK_CONFLICT");

          if (oldQuantity.greaterThan(0)) {
            await tx.inventoryMovement.create({
              data: {
                businessId,
                productId,
                invoiceId: existing.id,
                type: "RETURN_OUT",
                quantity: oldQuantity,
                totalCost: oldCost,
                averageCost: product.averageCost,
                description: `اصلاح موجودی فاکتور خرید ${existing.invoiceNumber}`,
              },
            });
          }
          if (newQuantity.greaterThan(0)) {
            await tx.inventoryMovement.create({
              data: {
                businessId,
                productId,
                invoiceId: existing.id,
                type: "PURCHASE",
                quantity: newQuantity,
                totalCost: newCost,
                averageCost: newStock.greaterThan(0)
                  ? new Prisma.Decimal(newInventoryValue.toString()).div(newStock)
                  : new Prisma.Decimal(0),
                description: `ویرایش فاکتور خرید ${existing.invoiceNumber}`,
              },
            });
          }
        }

        const before = {
          type: existing.type,
          invoiceDate: existing.invoiceDate.toISOString(),
          total: existing.total.toString(),
          subtotal: existing.subtotal.toString(),
          extraCosts: existing.extraCosts.toString(),
          discount: existing.discount.toString(),
          description: existing.description,
          contactId: existing.contactId,
          items: existing.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            total: item.total.toString(),
            costOfGoodsSold: item.costOfGoodsSold.toString(),
          })),
          payments: existing.payments.map((payment) => ({
            id: payment.id,
            method: payment.method,
            amount: payment.amount.toString(),
            status: payment.status,
            description: payment.description,
            paidAt: payment.paidAt.toISOString(),
            checkNumber: payment.checkNumber,
            checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
            checkDueAt: payment.checkDueAt?.toISOString() ?? null,
            payableTo: payment.payableTo,
            destinationDetails: payment.destinationDetails,
          })),
        };
        const after = {
          type: data.type,
          invoiceDate: data.invoiceDate
            ? new Date(`${data.invoiceDate}T00:00:00.000Z`).toISOString()
            : existing.invoiceDate.toISOString(),
          total: total.toString(),
          subtotal: subtotal.toString(),
          extraCosts: extraCosts.toString(),
          discount: discount.toString(),
          description: data.description || null,
          contactId: data.contactId || null,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            total: item.total.toString(),
          })),
          payments: data.payments.map((payment) => ({
            method: payment.method,
            amount: currencyInputToRial(payment.amount, business.currencyUnit).toString(),
            description: payment.description || null,
            checkNumber: payment.checkNumber || null,
            checkIssuedAt: payment.checkIssuedAt || null,
            checkDueAt: payment.checkDueAt || null,
            payableTo: payment.payableTo || null,
            destinationDetails: payment.destinationDetails || null,
          })),
        };
        const paymentRevision = await replaceIssuedAllocations();
        await tx.invoiceRevision.create({
          data: {
            invoiceId: existing.id,
            editorId: user!.id,
            before: { ...before, ...(paymentRevision ? { payments: paymentRevision.before } : {}) },
            after: { ...after, ...(paymentRevision ? { payments: paymentRevision.after } : {}) },
          },
        });

        const remainingExisting = [...existing.items];
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const matchingIndex = remainingExisting.findIndex(
            (previous) => previous.productId === item.productId,
          );
          if (matchingIndex >= 0) {
            const [previous] = remainingExisting.splice(matchingIndex, 1);
            await tx.invoiceItem.update({
              where: { id: previous.id },
              data: {
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                costOfGoodsSold: itemCosts.get(`${item.productId}:${index}`) ?? 0n,
              },
            });
          } else {
            await tx.invoiceItem.create({
              data: {
                invoiceId: existing.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                costOfGoodsSold: itemCosts.get(`${item.productId}:${index}`) ?? 0n,
              },
            });
          }
        }
        for (const stale of remainingExisting) {
          await tx.invoiceItem.delete({ where: { id: stale.id } });
        }
        return tx.invoice.update({
          where: { id: existing.id },
          data: {
            invoiceDate: data.invoiceDate
              ? new Date(`${data.invoiceDate}T00:00:00.000Z`)
              : existing.invoiceDate,
            description: data.description || null,
            subtotal,
            extraCosts,
            discount,
            discountPercent,
            reference: existing.type === "SALE" ? data.reference || null : null,
            referenceNumber: existing.type === "SALE" ? data.referenceNumber || null : null,
            total,
          },
          include: {
            contact: { select: { id: true, name: true } },
            items: { include: { product: { select: { name: true, unit: true } } } },
          },
        });
      }

      if (editingIssuedSale) {
        const before = {
          type: existing.type,
          total: existing.total.toString(),
          subtotal: existing.subtotal.toString(),
          extraCosts: existing.extraCosts.toString(),
          discount: existing.discount.toString(),
          description: existing.description,
          contactId: existing.contactId,
          items: existing.items.map((item) => ({
            id: item.id, productId: item.productId, quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(), total: item.total.toString(),
            costOfGoodsSold: item.costOfGoodsSold.toString(),
          })),
          payments: existing.payments.map((payment) => ({
            id: payment.id,
            method: payment.method,
            amount: payment.amount.toString(),
            status: payment.status,
            description: payment.description,
            paidAt: payment.paidAt.toISOString(),
            checkNumber: payment.checkNumber,
            checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
            checkDueAt: payment.checkDueAt?.toISOString() ?? null,
            payableTo: payment.payableTo,
            destinationDetails: payment.destinationDetails,
          })),
        };
        const after = {
          type: data.type,
          total: total.toString(),
          subtotal: subtotal.toString(),
          extraCosts: extraCosts.toString(),
          discount: discount.toString(),
          description: data.description || null,
          contactId: data.contactId || null,
          items: items.map((item) => ({
            productId: item.productId, quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(), total: item.total.toString(),
          })),
          payments: data.payments.map((payment) => ({
            method: payment.method,
            amount: currencyInputToRial(payment.amount, business.currencyUnit).toString(),
            description: payment.description || null,
            checkNumber: payment.checkNumber || null,
            checkIssuedAt: payment.checkIssuedAt || null,
            checkDueAt: payment.checkDueAt || null,
            payableTo: payment.payableTo || null,
            destinationDetails: payment.destinationDetails || null,
          })),
        };

        const beforeByProduct = new Map<string, Prisma.Decimal>();
        const afterByProduct = new Map<string, Prisma.Decimal>();
        for (const item of existing.items) {
          beforeByProduct.set(item.productId, (beforeByProduct.get(item.productId) ?? new Prisma.Decimal(0)).add(item.quantity));
        }
        for (const item of items) {
          afterByProduct.set(item.productId, (afterByProduct.get(item.productId) ?? new Prisma.Decimal(0)).add(item.quantity));
        }
        const allProductIds = new Set([...beforeByProduct.keys(), ...afterByProduct.keys()]);
        const costByProduct = new Map<string, bigint>();
        for (const item of existing.items) {
          costByProduct.set(item.productId, (costByProduct.get(item.productId) ?? 0n) + item.costOfGoodsSold);
        }
        const revisedCostByProduct = new Map(costByProduct);
        const costedQuantityByProduct = new Map<string, Prisma.Decimal>();
        for (const item of existing.items) {
          costedQuantityByProduct.set(
            item.productId,
            (costedQuantityByProduct.get(item.productId) ?? new Prisma.Decimal(0))
              .add(item.costedQuantity),
          );
        }
        const revisedCostedQuantityByProduct = new Map(costedQuantityByProduct);
        if (existing.backorders.length > 0) {
          const beforeLines = existing.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity.toString(),
          }));
          const afterLines = items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity.toString(),
          }));
          if (
            beforeLines.length !== afterLines.length ||
            beforeLines.some((line, index) =>
              line.productId !== afterLines[index]?.productId ||
              line.quantity !== afterLines[index]?.quantity
            )
          ) {
            throw new Error("BACKORDER_EDIT_LOCKED");
          }
        }
        for (const productId of allProductIds) {
          const delta = (afterByProduct.get(productId) ?? new Prisma.Decimal(0))
            .sub(beforeByProduct.get(productId) ?? new Prisma.Decimal(0));
          if (delta.isZero()) continue;
          const product = await tx.product.findFirst({
            where: { id: productId, businessId, isActive: true },
            select: { id: true, stock: true, inventoryValue: true, averageCost: true },
          });
          if (!product) throw new Error("PRODUCT_NOT_FOUND");
          const newStock = product.stock.sub(delta);
          if (delta.greaterThan(0) && newStock.lessThan(0)) {
            throw new Error("INSUFFICIENT_STOCK_TO_EDIT_SALE");
          }
          let valueDelta: bigint;
          if (delta.greaterThan(0)) {
            const calculatedValue = BigInt(product.averageCost.mul(delta).toFixed(0, Prisma.Decimal.ROUND_HALF_UP));
            valueDelta = calculatedValue > product.inventoryValue
              ? product.inventoryValue
              : calculatedValue;
            revisedCostByProduct.set(productId, (costByProduct.get(productId) ?? 0n) + valueDelta);
            const backedQuantity = product.stock.greaterThan(0)
              ? Prisma.Decimal.min(product.stock, delta)
              : new Prisma.Decimal(0);
            revisedCostedQuantityByProduct.set(
              productId,
              (costedQuantityByProduct.get(productId) ?? new Prisma.Decimal(0)).add(backedQuantity),
            );
          } else {
            const oldQuantity = beforeByProduct.get(productId) ?? new Prisma.Decimal(0);
            const oldCost = costByProduct.get(productId) ?? 0n;
            const oldCostedQuantity = costedQuantityByProduct.get(productId) ?? new Prisma.Decimal(0);
            const removedCostedQuantity = oldQuantity.isZero()
              ? new Prisma.Decimal(0)
              : Prisma.Decimal.min(
                  oldCostedQuantity,
                  oldCostedQuantity.mul(delta.abs()).div(oldQuantity),
                );
            valueDelta = oldQuantity.isZero()
              ? 0n
              : (oldCost * BigInt(delta.abs().mul(1_000_000).toFixed(0))) /
                BigInt(oldQuantity.mul(1_000_000).toFixed(0));
            revisedCostByProduct.set(productId, oldCost - valueDelta);
            revisedCostedQuantityByProduct.set(
              productId,
              oldCostedQuantity.sub(removedCostedQuantity),
            );
          }
          const newInventoryValue = delta.greaterThan(0)
            ? (product.inventoryValue > valueDelta ? product.inventoryValue - valueDelta : 0n)
            : addInventoryStock(
                product.stock,
                product.inventoryValue,
                delta.abs(),
                valueDelta,
              ).inventoryValue;
          if (newInventoryValue > MAX_CURRENCY_RIAL || newInventoryValue < 0n) {
            throw new Error("AMOUNT_OVERFLOW");
          }
          const updated = await tx.product.updateMany({
            where: {
              id: product.id, businessId, stock: product.stock,
              inventoryValue: product.inventoryValue, averageCost: product.averageCost,
            },
            data: {
              stock: newStock,
              inventoryValue: newInventoryValue,
              averageCost: newStock.greaterThan(0)
                ? new Prisma.Decimal(newInventoryValue.toString()).div(newStock)
                : new Prisma.Decimal(0),
            },
          });
          if (updated.count !== 1) throw new Error("STOCK_CONFLICT");
          const movement = await tx.inventoryMovement.create({
            data: {
              businessId, productId, invoiceId: existing.id,
              type: delta.greaterThan(0) ? "SALE" : "RETURN_IN",
              quantity: delta.abs(),
              totalCost: valueDelta,
              averageCost: product.averageCost,
              description: `اصلاح اقلام فاکتور صادرشده ${invoiceId}`,
            },
          });
          await reconcileNegativeStockBackorders(tx, movement);
        }

        const paymentRevision = await replaceIssuedAllocations();
        await tx.invoiceRevision.create({
          data: {
            invoiceId: existing.id,
            editorId: user!.id,
            before: { ...before, ...(paymentRevision ? { payments: paymentRevision.before } : {}) },
            after: { ...after, ...(paymentRevision ? { payments: paymentRevision.after } : {}) },
          },
        });
        const remainingExisting = [...existing.items];
        for (const item of items) {
          const matchingIndex = remainingExisting.findIndex((previous) => previous.productId === item.productId);
          const productItems = items.filter((candidate) => candidate.productId === item.productId);
          const productCost = revisedCostByProduct.get(item.productId) ?? 0n;
          const productCostedQuantity =
            revisedCostedQuantityByProduct.get(item.productId) ?? new Prisma.Decimal(0);
          const quantityUnits = BigInt(item.quantity.mul(1_000_000).toFixed(0));
          const totalUnits = productItems.reduce(
            (sum, candidate) => sum + BigInt(candidate.quantity.mul(1_000_000).toFixed(0)),
            0n,
          );
          const earlierAllocated = productItems.slice(0, productItems.indexOf(item)).reduce(
            (sum, candidate) => sum + BigInt(candidate.quantity.mul(1_000_000).toFixed(0)),
            0n,
          );
          const lineCost = totalUnits === 0n
            ? 0n
            : (productCost * (earlierAllocated + quantityUnits)) / totalUnits -
              (productCost * earlierAllocated) / totalUnits;
          const earlierQuantityUnits = totalUnits === 0n ? 0n : earlierAllocated;
          const lineCostedQuantity = totalUnits === 0n
            ? new Prisma.Decimal(0)
            : new Prisma.Decimal(
                (
                  BigInt(productCostedQuantity.mul(1_000_000).toFixed(0)) *
                    (earlierQuantityUnits + quantityUnits) /
                    totalUnits -
                  BigInt(productCostedQuantity.mul(1_000_000).toFixed(0)) *
                    earlierQuantityUnits /
                    totalUnits
                ).toString(),
              ).div(1_000_000);
          if (matchingIndex >= 0) {
            const [previous] = remainingExisting.splice(matchingIndex, 1);
            await tx.invoiceItem.update({
              where: { id: previous.id },
              data: {
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                costOfGoodsSold: lineCost,
                costedQuantity: lineCostedQuantity,
              },
            });
          } else {
            await tx.invoiceItem.create({
              data: {
                invoiceId: existing.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
                costOfGoodsSold: lineCost,
                costedQuantity: lineCostedQuantity,
              },
            });
          }
        }
        for (const stale of remainingExisting) {
          await tx.invoiceItem.delete({ where: { id: stale.id } });
        }
        return tx.invoice.update({
          where: { id: existing.id },
          data: {
            invoiceDate: data.invoiceDate
              ? new Date(`${data.invoiceDate}T00:00:00.000Z`)
              : existing.invoiceDate,
            description: data.description || null,
            subtotal, extraCosts, discount, discountPercent,
            reference: existing.type === "SALE" ? data.reference || null : null,
            referenceNumber: existing.type === "SALE" ? data.referenceNumber || null : null,
            total,
          },
          include: {
            contact: { select: { id: true, name: true } },
            items: { include: { product: { select: { name: true, unit: true } } } },
          },
        });
      }

      await tx.payment.deleteMany({
        where: { invoiceId: existing.id, status: "PENDING" },
      });

      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          invoiceDate: data.invoiceDate
            ? new Date(`${data.invoiceDate}T00:00:00.000Z`)
            : existing.invoiceDate,
          type: data.type,
          contactId: data.contactId || null,
          contactNameSnapshot: contactSnapshot?.name ?? null,
          contactPhoneSnapshot: contactSnapshot?.phone ?? null,
          contactAddressSnapshot: contactSnapshot?.address ?? null,
          description: data.description || null,
          subtotal,
          extraCosts,
          discount,
          discountPercent,
          reference: data.type === "SALE" ? data.reference || null : null,
          referenceNumber: data.type === "SALE" ? data.referenceNumber || null : null,
          total,
          items: {
            deleteMany: {},
            create: items,
          },
          payments: {
            create: data.payments.filter((payment) =>
              payment.method === "LEDGER"
                ? ledgerAmount > 0n
                : currencyInputToRial(payment.amount, business.currencyUnit) > 0n
            ).map((payment) => ({
              businessId,
              contactId: data.contactId || null,
              type: data.type === "SALE" ? "RECEIPT" : "PAYMENT",
              method: payment.method,
              amount: payment.method === "LEDGER"
                ? ledgerAmount
                : currencyInputToRial(payment.amount, business.currencyUnit),
              status: "PENDING",
              description: payment.description || null,
              trackingNumber: payment.checkNumber || null,
              checkNumber: payment.checkNumber || null,
              checkIssuedAt: payment.checkIssuedAt ? new Date(`${payment.checkIssuedAt}T00:00:00.000Z`) : null,
              checkDueAt: payment.checkDueAt ? new Date(`${payment.checkDueAt}T00:00:00.000Z`) : null,
              payableTo: payment.payableTo || null,
              destinationDetails: payment.destinationDetails || null,
            })),
          },
        },
        include: {
          contact: {
            select: { id: true, name: true },
          },
          items: {
            include: {
              product: {
                select: { name: true, unit: true },
              },
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({
      message: invoice.status === "ISSUED"
        ? "فاکتور صادرشده با موفقیت ویرایش شد."
        : "پیش‌نویس با موفقیت ویرایش شد.",
      invoice: serializeInvoice(invoice),
    });
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, { message: string; status: number }> = {
        INVOICE_NOT_FOUND: {
          message: "فاکتور پیدا نشد.",
          status: 404,
        },
        INVOICE_NOT_EDITABLE: {
          message: "این فاکتور قابل ویرایش نیست.",
          status: 409,
        },
        SALE_HAS_RETURNS: {
          message: "فاکتور فروش دارای مرجوعی است؛ برای حفظ سوابق، ویرایش مستقیم آن مجاز نیست.",
          status: 409,
        },
        PURCHASE_HISTORY_UNSAFE: {
          message: "به‌دلیل گردش‌های بعدی انبار یا ناهماهنگی سوابق خرید، ویرایش خودکار امن نیست.",
          status: 409,
        },
        ISSUED_CONTACT_IMMUTABLE: {
          message: "اطلاعات طرف حساب فاکتور صادرشده برای حفظ سابقه قابل تغییر نیست.",
          status: 409,
        },
        INVOICE_HAS_PAYMENTS: {
          message: "فاکتور دارای پرداخت ثبت‌شده است و نمی‌توان پیش‌نویس آن را جایگزین کرد.",
          status: 409,
        },
        PAYMENTS_UNDER_TOTAL: {
          message: "مجموع روش‌های پرداخت کمتر از مبلغ فاکتور است.",
          status: 400,
        },
        PAYMENTS_OVER_TOTAL: {
          message: "مجموع روش‌های پرداخت بیشتر از مبلغ فاکتور است.",
          status: 400,
        },
        PAYMENT_METHODS_REQUIRED: {
          message: "چهار روش پرداخت واقعی باید با مبلغ مشخص ارسال شوند و روش حساب دفتری اختیاری است.",
          status: 400,
        },
        CHECK_DUE_BEFORE_ISSUE: {
          message: "تاریخ سررسید چک نمی‌تواند قبل از تاریخ صدور باشد.",
          status: 400,
        },
        INVOICE_EXTERNAL_PAYMENTS_PRESENT: {
          message: "پرداخت‌های مستقل این فاکتور قابل جایگزینی با تخصیص اولیه نیستند؛ ابتدا آن‌ها را در مسیر اصلاح پرداخت تعیین تکلیف کنید.",
          status: 409,
        },
        INVOICE_PAYMENT_STATE_UNSAFE: {
          message: "وضعیت پرداخت‌های فاکتور برای ویرایش تخصیص‌ها امن نیست.",
          status: 409,
        },
        INVOICE_CLEARED_CHECKS_PRESENT: {
          message: "فاکتور چک پاس‌شده دارد؛ برای حفظ سابقه مالی، ویرایش تخصیص پرداخت آن مجاز نیست.",
          status: 409,
        },
        PAYMENT_PLAN_CONFLICT: {
          message: "تخصیص پرداخت هم‌زمان تغییر کرده؛ اطلاعات را تازه‌سازی کنید.",
          status: 409,
        },
        TOTAL_BELOW_CONFIRMED_PAYMENTS: {
          message: "مبلغ جدید نمی‌تواند از مجموع پرداخت‌های واقعی ثبت‌شده کمتر باشد.",
          status: 409,
        },
        ISSUED_TYPE_IMMUTABLE: {
          message: "نوع فاکتور صادرشده قابل تغییر نیست.",
          status: 409,
        },
        AMOUNT_OVERFLOW: {
          message: "مبلغ فاکتور از محدوده مجاز سامانه بیشتر است.",
          status: 400,
        },
        INSUFFICIENT_STOCK_TO_EDIT_SALE: {
          message: "موجودی برای افزایش مقدار فروش فاکتور صادرشده کافی نیست؛ ثبت موجودی منفی فقط هنگام صدور فاکتور فروش و با تأیید انجام می‌شود.",
          status: 409,
        },
        BACKORDER_EDIT_LOCKED: {
          message: "مقدار کالای دارای کسری سفارش را نمی‌توان پس از تخصیص تغییر داد؛ برای اصلاح سوابق، ابتدا کسری را تعیین تکلیف کنید.",
          status: 409,
        },
        BUSINESS_NOT_FOUND: {
          message: "کسب‌وکار پیدا نشد.",
          status: 404,
        },
        PRODUCT_NOT_FOUND: {
          message: "یک یا چند کالا معتبر نیستند.",
          status: 400,
        },
        CONTACT_NOT_FOUND: {
          message: "طرف حساب انتخاب‌شده معتبر نیست.",
          status: 400,
        },
        CUSTOMER_REQUIRED: {
          message: "مشتری را انتخاب یا اطلاعات مشتری موقت را وارد کنید.",
          status: 400,
        },
        CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT: {
          message: "برای ثبت بدهی یا چک تسویه‌نشده، مشتری دارای حساب را انتخاب کنید.",
          status: 400,
        },
        INVALID_QUANTITY: {
          message: "تعداد کالا باید بیشتر از صفر باشد.",
          status: 400,
        },
        INVALID_CURRENCY_AMOUNT: {
          message: "مبلغ واردشده با واحد پول کسب‌وکار سازگار نیست.",
          status: 400,
        },
        INVALID_DISCOUNT: {
          message: "تخفیف نمی‌تواند از مجموع مبلغ فاکتور بیشتر باشد.",
          status: 400,
        },
        INVALID_DISCOUNT_PERCENT: {
          message: "درصد تخفیف باید بین صفر تا صد باشد.",
          status: 400,
        },
      };

      const knownError = messages[error.message];

      if (knownError) {
        return NextResponse.json(
          { message: knownError.message },
          { status: knownError.status }
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return NextResponse.json(
          { message: "فاکتور یا موجودی هم‌زمان تغییر کرده؛ اطلاعات را تازه‌سازی کنید." },
          { status: 409 },
        );
      }
    }

    console.error("Update invoice error:", error);

    return NextResponse.json(
      { message: "خطا در ویرایش پیش‌نویس." },
      { status: 500 }
    );
  }
}

// حذف پیش‌نویس
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const result = await prisma.invoice.deleteMany({
      where: {
        id: invoiceId,
        businessId: auth.businessId,
        status: "DRAFT",
        type: "PURCHASE",
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        {
          message: "فاکتور پیدا نشد یا امکان حذف آن وجود ندارد.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "پیش‌نویس با موفقیت حذف شد.",
    });
  } catch (error) {
    console.error("Delete invoice error:", error);

    return NextResponse.json(
      { message: "خطا در حذف پیش‌نویس." },
      { status: 500 }
    );
  }
}
