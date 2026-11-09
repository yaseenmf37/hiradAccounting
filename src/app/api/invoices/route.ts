
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
import { addInventoryStock, reconcileNegativeStockBackorders } from "@/lib/inventory";

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
const expectedPaymentMethods = ["CASH", "CHECK", "CARD_TO_CARD", "POS"] as const;

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
  discountPercent: Prisma.Decimal | null;
  reference: string | null;
  referenceNumber: string | null;
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
    discountPercent: invoice.discountPercent?.toString() ?? null,
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
    const settlement = params.get("settlement") ?? "all";
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
      (startDate && endDate && startDate > endDate) ||
      !["all", "settled", "outstanding"].includes(settlement)
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
                { reference: { contains: search, mode: "insensitive" } },
                { referenceNumber: { contains: search, mode: "insensitive" } },
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

    if (settlement !== "all") {
      const filters: Prisma.Sql[] = [Prisma.sql`i."businessId" = ${auth.businessId}`];
      if (type === "PURCHASE" || type === "SALE") {
        filters.push(Prisma.sql`i."type" = ${type}::"InvoiceType"`);
      }
      if (status === "DRAFT" || status === "ISSUED" || status === "CANCELLED") {
        filters.push(Prisma.sql`i."status" = ${status}::"InvoiceStatus"`);
      }
      if (search) {
        const searchPattern = `%${search}%`;
        filters.push(Prisma.sql`(
          i."invoiceNumber" ILIKE ${searchPattern}
          OR COALESCE(c."name", i."contactNameSnapshot", '') ILIKE ${searchPattern}
          OR COALESCE(i."reference", '') ILIKE ${searchPattern}
          OR COALESCE(i."referenceNumber", '') ILIKE ${searchPattern}
        )`);
      }
      if (startDate) {
        filters.push(Prisma.sql`i."invoiceDate" >= ${new Date(`${startDate}T00:00:00.000Z`)}`);
      }
      if (endDate) {
        filters.push(Prisma.sql`i."invoiceDate" < ${new Date(
          new Date(`${endDate}T00:00:00.000Z`).getTime() + 86400000,
        )}`);
      }
      const invoiceFilter = Prisma.join(filters, " AND ");
      const dueFilter = settlement === "settled"
        ? Prisma.sql`balance."amount" <= 0`
        : Prisma.sql`balance."amount" > 0`;
      const cursorFilter = pagination.cursor
        ? Prisma.sql`(i."invoiceDate", i."id") < (
            SELECT cursor_invoice."invoiceDate", cursor_invoice."id"
            FROM "Invoice" cursor_invoice
            WHERE cursor_invoice."id" = ${pagination.cursor}
              AND cursor_invoice."businessId" = ${auth.businessId}
          )`
        : Prisma.sql`TRUE`;
      const balanceCtes = Prisma.sql`
        WITH paid AS (
          SELECT
            p."invoiceId",
            SUM(p."amount") FILTER (
              WHERE p."status" = 'CONFIRMED'
                AND p."method" <> 'LEDGER'
                AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)
            ) AS amount
          FROM "Payment" p
          WHERE p."businessId" = ${auth.businessId}
            AND p."invoiceId" IS NOT NULL
          GROUP BY p."invoiceId"
        ),
        returns AS (
          SELECT "invoiceId", SUM(amount) AS amount
          FROM (
            SELECT "invoiceId", "total" AS amount
            FROM "SalesReturn"
            WHERE "businessId" = ${auth.businessId}
            UNION ALL
            SELECT "invoiceId", "total" AS amount
            FROM "PurchaseReturn"
            WHERE "businessId" = ${auth.businessId}
          ) return_rows
          GROUP BY "invoiceId"
        ),
        invoice_balances AS (
          SELECT
            i."id",
            i."invoiceDate",
            i."total" - COALESCE(paid.amount, 0) - COALESCE(returns.amount, 0) AS amount
          FROM "Invoice" i
          LEFT JOIN paid ON paid."invoiceId" = i."id"
          LEFT JOIN returns ON returns."invoiceId" = i."id"
          LEFT JOIN "Contact" c ON c."id" = i."contactId" AND c."businessId" = i."businessId"
          WHERE ${invoiceFilter}
        )
      `;
      const [filteredRows, countRows] = await prisma.$transaction([
        prisma.$queryRaw<{ id: string }[]>`
          ${balanceCtes}
          SELECT i."id"
          FROM invoice_balances balance
          JOIN "Invoice" i ON i."id" = balance."id"
          WHERE ${dueFilter}
            AND ${cursorFilter}
          ORDER BY balance."invoiceDate" DESC, balance."id" DESC
          LIMIT ${pagination.limit + 1}
        `,
        prisma.$queryRaw<{ total: bigint }[]>`
          ${balanceCtes}
          SELECT COUNT(*) AS total
          FROM invoice_balances balance
          WHERE ${dueFilter}
        `,
      ]);
      const hasMore = filteredRows.length > pagination.limit;
      const pageIds = filteredRows.slice(0, pagination.limit).map((row) => row.id);
      const pageRows = pageIds.length
        ? await prisma.invoice.findMany({
            where: { id: { in: pageIds }, businessId: auth.businessId },
            include: {
              contact: { select: { id: true, name: true } },
              items: { include: { product: { select: { name: true, unit: true } } } },
            },
          })
        : [];
      const invoicesById = new Map(pageRows.map((invoice) => [invoice.id, invoice]));
      return NextResponse.json({
        invoices: pageIds.flatMap((id) => {
          const invoice = invoicesById.get(id);
          return invoice ? [serializeInvoice(invoice)] : [];
        }),
        total: Number(countRows[0]?.total ?? 0n),
        nextCursor: hasMore ? pageIds.at(-1) ?? null : null,
      });
    }

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
      data.payments.length < expectedPaymentMethods.length ||
      data.payments.length > expectedPaymentMethods.length + 1 ||
      new Set(data.payments.map((payment) => payment.method)).size !== data.payments.length ||
      !expectedPaymentMethods.every((method) => data.payments.some((payment) => payment.method === method))
    ) {
      return NextResponse.json({ message: "چهار روش پرداخت واقعی باید با مبلغ مشخص ارسال شوند و روش حساب دفتری اختیاری است." }, { status: 400 });
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
    const extraCosts = currencyInputToRial(data.extraCosts, business.currencyUnit);
    const discountPercent = data.discountPercent === undefined || data.discountPercent === null
      ? null
      : new Prisma.Decimal(data.discountPercent);
    if (discountPercent && (discountPercent.lessThan(0) || discountPercent.greaterThan(100))) {
      return NextResponse.json({ message: "درصد تخفیف باید بین صفر تا صد باشد." }, { status: 400 });
    }

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
    if (data.type === "PURCHASE" && items.some((item) => item.unitPrice <= 0n)) {
      return NextResponse.json(
        { message: "قیمت واحد هر کالا در فاکتور خرید باید بیشتر از صفر باشد." },
        { status: 400 },
      );
    }

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

    const discountBase = subtotal;
    const discount = discountPercent
      ? BigInt(new Prisma.Decimal(discountBase.toString())
          .mul(discountPercent)
          .div(100)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(0))
      : currencyInputToRial(data.discount, business.currencyUnit);

    if (discount > discountBase) {
      return NextResponse.json(
        { message: "تخفیف نمی‌تواند از مجموع مبلغ فاکتور بیشتر باشد." },
        { status: 400 }
      );
    }

    const total = subtotal + extraCosts - discount;
    const paymentTotal = data.payments.reduce(
      (sum, payment) => payment.method === "LEDGER"
        ? sum
        : sum + currencyInputToRial(payment.amount, business.currencyUnit),
      0n,
    );

    if (paymentTotal > total) {
      return NextResponse.json(
        { message: "مجموع پرداخت‌های واقعی نمی‌تواند از مبلغ فاکتور بیشتر باشد." },
        { status: 400 },
      );
    }
    const ledgerAmount = total - paymentTotal;
    const contactSnapshot = data.contactId
      ? await prisma.contact.findFirst({
          where: { id: data.contactId, businessId },
          select: { name: true, phone: true, address: true },
        })
      : data.contactSnapshot;

    const allocationBatchId = crypto.randomUUID();
    const invoice = await prisma.$transaction(async (tx) => {
      const sequence = await tx.$queryRaw<{ invoiceNumber: bigint }[]>`
        UPDATE "Business"
        SET "nextInvoiceNumber" = "nextInvoiceNumber" + 1
        WHERE "id" = ${businessId}
          AND "nextInvoiceNumber" < ${MAX_CURRENCY_RIAL}
        RETURNING "nextInvoiceNumber" - 1 AS "invoiceNumber"
      `;
      if (!sequence[0]) throw new Error("INVOICE_NUMBER_OVERFLOW");
      const invoiceNumber = String(sequence[0].invoiceNumber);
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
        discountPercent,
        reference: data.type === "SALE" ? data.reference || null : null,
        referenceNumber: data.type === "SALE" ? data.referenceNumber || null : null,
        total,
        description: data.description || null,
        items: {
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
        const acquisitionCost = subtotal - discount;
        const discountAllocations = allocateAmount(
          discount,
          created.items.map((item) =>
            BigInt(
              item.quantity
                .mul(1000)
                .toDecimalPlaces(0)
                .toFixed(0)
            )
          )
        );

        const itemCosts = created.items.map(
          (item, index) => item.total - discountAllocations[index]
        );

        if (itemCosts.some((cost) => cost < 0n)) {
          throw new Error("DISCOUNT_EXCEEDS_ITEM_TOTAL");
        }
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
          const inventory = addInventoryStock(
            product.stock,
            product.inventoryValue,
            quantity,
            totalCost,
          );
          const { stock: newStock, inventoryValue: newInventoryValue, averageCost: newAverageCost } = inventory;
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
              averageCost: newAverageCost,
            },
          });
          if (updated.count !== 1) throw new Error("STOCK_CONFLICT");

          for (const item of group) {
            await tx.invoiceItem.update({
              where: { id: item.id },
              data: { costOfGoodsSold: costsByItemId.get(item.id) ?? 0n },
            });
          }

          const movement = await tx.inventoryMovement.create({
            data: {
              businessId,
              productId,
              invoiceId: created.id,
              type: "PURCHASE",
              quantity,
              totalCost,
              averageCost: newAverageCost,
              description: `صدور فاکتور خرید ${created.invoiceNumber}`,
            },
          });
          await reconcileNegativeStockBackorders(tx, movement);
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
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 20000,
    });

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
    if (error instanceof Error && error.message === "INVOICE_NUMBER_OVERFLOW") {
      return NextResponse.json(
        { message: "ظرفیت شماره‌گذاری فاکتور کسب‌وکار به پایان رسیده است." },
        { status: 409 },
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
        { message: "تداخل هم‌زمان در شماره‌گذاری فاکتور یا موجودی رخ داد؛ دوباره تلاش کنید." },
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
