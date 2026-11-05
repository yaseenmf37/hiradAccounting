
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyInputToRial, MAX_CURRENCY_RIAL } from "@/lib/currency";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

const amountSchema = z.string().regex(/^\d{1,18}(\.\d)?$/);

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
  extraCosts: amountSchema.default("0"),
  discount: amountSchema.default("0"),
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
const expectedPaymentMethods = ["CASH", "CHECK", "CARD_TO_CARD", "POS", "LEDGER"] as const;

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
  contact: { id: string; name: string } | null;
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
    product: { name: string; unit: string };
  }[];
}) {
  return {
    ...invoice,
    subtotal: invoice.subtotal.toString(),
    extraCosts: invoice.extraCosts.toString(),
    discount: invoice.discount.toString(),
    total: invoice.total.toString(),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
      costOfGoodsSold: item.costOfGoodsSold.toString(),
    })),
  };
}


// دریافت فهرست فاکتورها
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const params = request.nextUrl.searchParams;
    const type = params.get("type");
    const status = params.get("status");
    const search = params.get("search")?.trim();
    const startDate = params.get("startDate");
    const endDate = params.get("endDate");
    const pagination = parseCursorPageParams(params);

    if (!pagination) {
      return NextResponse.json(
        { message: "محدوده صفحه‌بندی معتبر نیست." },
        { status: 400 }
      );
    }
    const isValidDate = (value: string | null) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (
      !isValidDate(startDate) ||
      !isValidDate(endDate) ||
      (startDate && endDate && startDate > endDate)
    ) {
      return NextResponse.json(
        { message: "بازه تاریخی فاکتور معتبر نیست." },
        { status: 400 },
      );
    }

    const where: Prisma.InvoiceWhereInput = {
        businessId: auth.businessId,
        ...(type === "PURCHASE" || type === "SALE" ? { type } : {}),
        ...(status === "DRAFT" || status === "ISSUED" || status === "CANCELLED"
          ? { status }
          : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: "insensitive" } },
                { contact: { name: { contains: search, mode: "insensitive" } } },
                { contactNameSnapshot: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(startDate || endDate
          ? {
              invoiceDate: {
                ...(startDate
                  ? { gte: new Date(`${startDate}T00:00:00.000Z`) }
                  : {}),
                ...(endDate
                  ? {
                      lt: new Date(
                        new Date(`${endDate}T00:00:00.000Z`).getTime() +
                          24 * 60 * 60 * 1000,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };

    const [rows, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true } },
          items: {
            include: {
              product: { select: { name: true, unit: true } },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
      }),
      prisma.invoice.count({ where }),
    ]);
    const page = getCursorPage(rows, pagination.limit);

    return NextResponse.json({
      invoices: page.items.map(serializeInvoice),
      total,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    console.error("Get invoices error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت فاکتورها." },
      { status: 500 }
    );
  }
}
// ایجاد پیش‌نویس فاکتور
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

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
    if (
      data.payments.length !== expectedPaymentMethods.length ||
      new Set(data.payments.map((payment) => payment.method)).size !== expectedPaymentMethods.length ||
      !expectedPaymentMethods.every((method) => data.payments.some((payment) => payment.method === method))
    ) {
      return NextResponse.json({ message: "هر پنج روش پرداخت باید با مبلغ مشخص (حتی صفر) ارسال شوند." }, { status: 400 });
    }
    if (data.payments.some((payment) =>
      payment.method === "CHECK" &&
      /[1-9]/.test(payment.amount.replace(".", "")) &&
      (!payment.checkNumber || !payment.checkIssuedAt || !payment.checkDueAt || !payment.payableTo)
    )) {
      return NextResponse.json({ message: "برای چک، شماره، تاریخ صدور، سررسید و در وجه را تکمیل کنید." }, { status: 400 });
    }
    const businessId = auth.businessId;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { currencyUnit: true },
    });

    if (!business) {
      return NextResponse.json(
        { message: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const productIds = [...new Set(data.items.map((item) => item.productId))];

    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        businessId,
        isActive: true,
      },
      select: { id: true },
    });

    if (products.length !== productIds.length) {
      return NextResponse.json(
        { message: "یک یا چند کالا معتبر نیستند یا متعلق به این کسب‌وکار نیستند." },
        { status: 400 }
      );
    }

    if (data.contactId) {
      const contact = await prisma.contact.findFirst({
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
        return NextResponse.json(
          { message: "طرف حساب انتخاب‌شده معتبر نیست." },
          { status: 400 }
        );
      }
    }
    if (data.type === "SALE" && !data.contactId && !data.contactSnapshot) {
      return NextResponse.json(
        { message: "مشتری را انتخاب یا اطلاعات مشتری موقت را وارد کنید." },
        { status: 400 },
      );
    }

    const extraCosts = currencyInputToRial(data.extraCosts, business.currencyUnit);
    const discount = currencyInputToRial(data.discount, business.currencyUnit);

    const items = data.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
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

      if (quantity.lessThanOrEqualTo(0)) {
        throw new Error("INVALID_QUANTITY");
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
      return NextResponse.json(
        { message: "مبلغ فاکتور از محدوده مجاز سامانه بیشتر است." },
        { status: 400 },
      );
    }

    if (discount > subtotal + extraCosts) {
      return NextResponse.json(
        { message: "تخفیف نمی‌تواند از مجموع مبلغ فاکتور بیشتر باشد." },
        { status: 400 }
      );
    }

    const total = subtotal + extraCosts - discount;
    const paymentTotal = data.payments.reduce(
      (sum, payment) => sum + currencyInputToRial(payment.amount, business.currencyUnit),
      0n,
    );

    if (paymentTotal !== total) {
      return NextResponse.json(
        { message: paymentTotal < total ? "مجموع روش‌های پرداخت کمتر از مبلغ فاکتور است." : "مجموع روش‌های پرداخت بیشتر از مبلغ فاکتور است." },
        { status: 400 },
      );
    }

    const contactSnapshot = data.contactId
      ? await prisma.contact.findFirst({
          where: { id: data.contactId, businessId },
          select: { name: true, phone: true, address: true },
        })
      : data.contactSnapshot;

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = data.type === "SALE" ? "S" : "P";
    const invoiceNumber = `${prefix}-${datePart}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const allocationBatchId = crypto.randomUUID();
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
        businessId,
        contactId: data.contactId || null,
        contactNameSnapshot: contactSnapshot?.name ?? null,
        contactPhoneSnapshot: contactSnapshot?.phone ?? null,
        contactAddressSnapshot: contactSnapshot?.address ?? null,
        paymentPlanRecorded: true,
        type: data.type,
        status: "DRAFT",
        invoiceNumber,
        invoiceDate: data.invoiceDate
          ? new Date(`${data.invoiceDate}T00:00:00.000Z`)
          : new Date(),
        subtotal,
        extraCosts,
        discount,
        total,
        description: data.description || null,
        items: {
          create: items,
        },
        payments: {
          create: data.payments.filter((payment) => currencyInputToRial(payment.amount, business.currencyUnit) > 0n).map((payment) => ({
            businessId,
            contactId: data.contactId || null,
            type: data.type === "SALE" ? "RECEIPT" : "PAYMENT",
            method: payment.method,
            amount: currencyInputToRial(payment.amount, business.currencyUnit),
            status: "PENDING",
            allocationBatchId,
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
          contact: { select: { id: true, name: true } },
          items: {
            include: {
              product: { select: { name: true, unit: true } },
            },
          },
        },
      });

      if (data.type === "PURCHASE") {
        const acquisitionCost = subtotal + extraCosts - discount;
        const itemCosts = allocateAmount(acquisitionCost, created.items.map((item) => item.total));
        const costsByItemId = new Map(
          created.items.map((item, index) => [item.id, itemCosts[index]]),
        );
        const groups = new Map<string, typeof created.items>();
        for (const item of created.items) {
          const group = groups.get(item.productId) ?? [];
          group.push(item);
          groups.set(item.productId, group);
        }

        for (const [productId, group] of groups) {
          const product = await tx.product.findFirst({
            where: { id: productId, businessId, isActive: true },
            select: { id: true, stock: true, averageCost: true, inventoryValue: true },
          });
          if (!product) throw new Error("PRODUCT_NOT_FOUND");

          const quantity = group.reduce(
            (sum, item) => sum.add(item.quantity),
            new Prisma.Decimal(0),
          );
          const totalCost = group.reduce(
            (sum, item) => sum + (costsByItemId.get(item.id) ?? 0n),
            0n,
          );
          const newStock = product.stock.add(quantity);
          let newInventoryValue: bigint;
          if (product.stock.lessThan(0)) {
            const remainingQuantity = newStock.greaterThan(0)
              ? newStock
              : new Prisma.Decimal(0);
            const quantityUnits = BigInt(quantity.mul(1_000_000).toFixed(0));
            const remainingUnits = BigInt(remainingQuantity.mul(1_000_000).toFixed(0));
            newInventoryValue = quantityUnits > 0n
              ? (totalCost * remainingUnits) / quantityUnits
              : 0n;
          } else {
            newInventoryValue = product.inventoryValue + totalCost;
          }
          if (newInventoryValue > MAX_CURRENCY_RIAL || newInventoryValue < 0n) {
            throw new Error("INVENTORY_VALUE_OVERFLOW");
          }

          const updated = await tx.product.updateMany({
            where: {
              id: product.id,
              businessId,
              isActive: true,
              stock: product.stock,
              averageCost: product.averageCost,
              inventoryValue: product.inventoryValue,
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

          for (const item of group) {
            await tx.invoiceItem.update({
              where: { id: item.id },
              data: { costOfGoodsSold: costsByItemId.get(item.id) ?? 0n },
            });
          }

          await tx.inventoryMovement.create({
            data: {
              businessId,
              productId,
              invoiceId: created.id,
              type: "PURCHASE",
              quantity,
              totalCost,
              averageCost: newStock.greaterThan(0)
                ? new Prisma.Decimal(newInventoryValue.toString()).div(newStock)
                : new Prisma.Decimal(0),
              description: `صدور فاکتور خرید ${created.invoiceNumber}`,
            },
          });
        }

        const issued = await tx.invoice.updateMany({
          where: { id: created.id, businessId, status: "DRAFT" },
          data: {
            status: "ISSUED",
            issuedAt: new Date(),
          },
        });
        if (issued.count !== 1) throw new Error("INVOICE_ALREADY_ISSUED");

        await tx.payment.updateMany({
          where: { invoiceId: created.id, businessId, status: "PENDING" },
          data: { status: "CONFIRMED" },
        });
      }

      return tx.invoice.findFirstOrThrow({
        where: { id: created.id, businessId },
        include: {
          contact: { select: { id: true, name: true } },
          items: { include: { product: { select: { name: true, unit: true } } } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json(
      {
        message: data.type === "PURCHASE"
          ? "فاکتور خرید با موفقیت صادر شد."
          : "پیش‌نویس فاکتور با موفقیت ایجاد شد.",
        invoice: serializeInvoice(invoice),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_QUANTITY") {
      return NextResponse.json(
        { message: "تعداد کالا باید بیشتر از صفر باشد." },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === "INVALID_CURRENCY_AMOUNT") {
      return NextResponse.json(
        { message: "مبلغ واردشده با واحد پول کسب‌وکار سازگار نیست." },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === "AMOUNT_OVERFLOW") {
      return NextResponse.json(
        { message: "مبلغ یکی از اقلام از محدوده مجاز سامانه بیشتر است." },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "INVENTORY_VALUE_OVERFLOW") {
      return NextResponse.json(
        { message: "ارزش موجودی از محدوده مجاز سامانه بیشتر است." },
        { status: 400 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json(
        { message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید." },
        { status: 409 },
      );
    }

    console.error("Create invoice error:", error);

    return NextResponse.json(
      { message: "خطا در ایجاد پیش‌نویس فاکتور." },
      { status: 500 }
    );
  }
}
