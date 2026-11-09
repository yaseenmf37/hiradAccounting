import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_CURRENCY_RIAL } from "@/lib/currency";
import { addInventoryStock, reconcileNegativeStockBackorders } from "@/lib/inventory";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

type InvoiceItemData = {
  id: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: bigint;
  total: bigint;
};

// تقسیم دقیق مبلغ بین اقلام بر اساس وزن و جلوگیری از گم شدن باقیمانده
function allocateAmount(
  amount: bigint,
  weights: bigint[]
): bigint[] {
  if (weights.length === 0) return [];

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);

  if (totalWeight <= 0n) {
    throw new Error("INVALID_ALLOCATION");
  }

  const allocations = weights.map(
    (weight) => (amount * weight) / totalWeight
  );

  let remainder =
    amount - allocations.reduce((sum, value) => sum + value, 0n);

  for (let i = 0; remainder > 0n; i = (i + 1) % allocations.length) {
    allocations[i] += 1n;
    remainder -= 1n;
  }

  return allocations;
}

function serializeInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  issuedAt: Date | null;
  total: bigint;
}) {
  return {
    ...invoice,
    total: invoice.total.toString(),
  };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      );
    }

    if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      );
    }

    const { invoiceId } = await context.params;
    const businessId = user.business.id;
    const result = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: {
            id: invoiceId,
            businessId,
          },
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
        if (invoice.status !== "DRAFT") {
          throw new Error("INVOICE_NOT_DRAFT");
        }
        if (invoice.items.length === 0) {
          throw new Error("INVOICE_EMPTY");
        }
        if (invoice.items.some((item) => item.unitPrice <= 0n)) {
          throw new Error("INVOICE_ITEM_PRICE_REQUIRED");
        }
        const paymentTotal = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0n);
        if (invoice.paymentPlanRecorded && paymentTotal !== invoice.total) {
          throw new Error("PAYMENTS_NOT_EQUAL");
        }
        const immediatelyPaidTotal = invoice.payments.reduce(
          (sum, payment) => payment.method === "LEDGER" ||
            (payment.method === "CHECK" && payment.checkClearedAt === null)
            ? sum
            : sum + payment.amount,
          0n,
        );
        if (invoice.type === "SALE" && !invoice.contactId && immediatelyPaidTotal < invoice.total) {
          throw new Error("CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT");
        }

        const items = invoice.items as InvoiceItemData[];

        // تجمیع ردیف‌های مربوط به یک کالا
        const groupedItems = new Map<
          string,
          {
            quantity: Prisma.Decimal;
            items: InvoiceItemData[];
          }
        >();

        for (const item of items) {
          if (!item.quantity.greaterThan(0)) {
            throw new Error("INVALID_QUANTITY");
          }

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

        // تخصیص بهای تمام‌شده خرید به هر ردیف فاکتور
        const purchaseCosts = new Map<string, bigint>();

        if (invoice.type === "PURCHASE") {
          const subtotal = items.reduce(
            (sum, item) => sum + item.total,
            0n
          );

          if (subtotal <= 0n) {
            throw new Error("INVALID_PURCHASE_TOTAL");
          }

          if (invoice.discount > subtotal) {
            throw new Error("INVALID_PURCHASE_DISCOUNT");
          }

          const acquisitionTotal =
            subtotal + invoice.extraCosts - invoice.discount;

          if (acquisitionTotal < 0n) {
            throw new Error("INVALID_ACQUISITION_COST");
          }

          const allocations = allocateAmount(
            acquisitionTotal,
            items.map((item) => item.total)
          );

          items.forEach((item, index) => {
            purchaseCosts.set(item.id, allocations[index]);
          });
        }

        // پردازش هر کالا فقط یک‌بار
        for (const [productId, group] of groupedItems) {
          const product = await tx.product.findFirst({
            where: {
              id: productId,
              businessId,
              isActive: true,
            },
            select: {
              id: true,
              stock: true,
              averageCost: true,
              inventoryValue: true,
            },
          });

          if (!product) {
            throw new Error("PRODUCT_NOT_FOUND");
          }

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
              totalCost,
            );
            newStock = inventory.stock;
            newInventoryValue = inventory.inventoryValue;
            newAverageCost = inventory.averageCost;
          } else {
            const available = product.stock.greaterThan(0)
              ? Prisma.Decimal.min(product.stock, group.quantity)
              : new Prisma.Decimal(0);
            const costQuantity = available;
            newStock = product.stock.sub(group.quantity);
            const calculatedCost = costQuantity.equals(product.stock) && product.stock.greaterThan(0)
              ? product.inventoryValue
              : BigInt(product.averageCost.mul(costQuantity).toFixed(0, Prisma.Decimal.ROUND_HALF_UP));
            totalCost = calculatedCost > product.inventoryValue
              ? product.inventoryValue
              : calculatedCost;
            newInventoryValue = product.stock.greaterThan(0)
              ? product.inventoryValue - totalCost
              : 0n;
            newAverageCost = newStock.lessThanOrEqualTo(0)
              ? new Prisma.Decimal(0)
              : new Prisma.Decimal(newInventoryValue.toString()).div(newStock);

            // تخصیص بهای تمام‌شده فروش بین ردیف‌های همان کالا
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
            const itemCosts = totalCost === 0n
              ? group.items.map(() => 0n)
              : allocateAmount(totalCost, costWeights);

            for (let i = 0; i < group.items.length; i++) {
              await tx.invoiceItem.update({
                where: { id: group.items[i].id },
                data: {
                  costOfGoodsSold: itemCosts[i],
                  costedQuantity: costedQuantities[i],
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
                const itemOutstanding = item.quantity.sub(itemAvailable);
                if (itemOutstanding.greaterThan(0)) {
                  await tx.backorder.create({
                    data: {
                      businessId,
                      invoiceId: invoice.id,
                      invoiceItemId: item.id,
                      productId,
                      requested: item.quantity,
                      fulfilled: itemAvailable,
                      outstanding: itemOutstanding,
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

          // به‌روزرسانی اتمیک موجودی و ارزش آن
          const updated = await tx.product.updateMany({
            where: {
              id: productId,
              businessId,
              isActive: true,
              stock: product.stock,
              averageCost: product.averageCost,
              inventoryValue: product.inventoryValue,
            },
            data: {
              stock: newStock,
              averageCost: newAverageCost,
              inventoryValue: newInventoryValue,
            },
          });

          if (updated.count !== 1) {
            throw new Error("STOCK_CONFLICT");
          }

          // ثبت گردش انبار همراه با بهای تمام‌شده
          const movementQuantity = group.quantity;
          if (movementQuantity.greaterThan(0)) {
            const movement = await tx.inventoryMovement.create({
              data: {
                businessId,
                productId,
                invoiceId: invoice.id,
                type: invoice.type === "PURCHASE" ? "PURCHASE" : "SALE",
                quantity: movementQuantity,
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

        // صدور فاکتور فقط در صورت پیش‌نویس بودن
        const issuedAt = new Date();

        const issued = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            businessId,
            status: "DRAFT",
          },
          data: {
            status: "ISSUED",
            issuedAt,
            costingRecordedAt: null,
          },
        });
        if (issued.count !== 1) {
          throw new Error("INVOICE_ALREADY_ISSUED");
        }

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
          where: { invoiceId: invoice.id, status: "PENDING" },
          data: { status: "CONFIRMED" },
        });
        if (invoice.type === "SALE") {
          const items = await tx.invoiceItem.findMany({
            where: { invoiceId: invoice.id },
            select: { quantity: true, costedQuantity: true },
          });
          const allCosted = items.every(
            (item) => item.costedQuantity.greaterThanOrEqualTo(item.quantity),
          );
          if (allCosted) {
            await tx.invoice.updateMany({
              where: { id: invoice.id, businessId, status: "ISSUED" },
              data: { costingRecordedAt: issuedAt },
            });
          }
        }

        return tx.invoice.findUnique({
          where: { id: invoice.id },
          select: {
            id: true,
            invoiceNumber: true,
            type: true,
            status: true,
            issuedAt: true,
            total: true,
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 20000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    return NextResponse.json({
      message: "فاکتور با موفقیت صادر شد.",
      invoice: result ? serializeInvoice(result) : null,
    });
  } catch (error) {
    if (error instanceof Error) {
      const knownErrors: Record<
        string,
        { message: string; status: number }
      > = {
        INVOICE_NOT_FOUND: {
          message: "فاکتور پیدا نشد.",
          status: 404,
        },
        INVOICE_NOT_DRAFT: {
          message: "این فاکتور قبلاً صادر یا لغو شده است.",
          status: 409,
        },
        INVOICE_EMPTY: {
          message: "فاکتور هیچ کالایی ندارد.",
          status: 400,
        },
        INVOICE_ITEM_PRICE_REQUIRED: {
          message: "برای صدور فاکتور، قیمت واحد همه کالاها باید بیشتر از صفر باشد.",
          status: 400,
        },
        PRODUCT_NOT_FOUND: {
          message: "یک یا چند کالا دیگر معتبر یا فعال نیستند.",
          status: 400,
        },
        INSUFFICIENT_STOCK: {
          message: "موجودی یک یا چند کالا برای صدور فاکتور کافی نیست.",
          status: 409,
        },
        PAYMENTS_NOT_EQUAL: {
          message: "مجموع روش‌های پرداخت باید دقیقاً با مبلغ فاکتور برابر باشد.",
          status: 400,
        },
        CUSTOMER_ACCOUNT_REQUIRED_FOR_DEBT: {
          message: "برای ثبت بدهی یا چک تسویه‌نشده، مشتری دارای حساب را انتخاب کنید.",
          status: 400,
        },
        INVOICE_ALREADY_ISSUED: {
          message: "این فاکتور هم‌زمان توسط درخواست دیگری صادر شده است.",
          status: 409,
        },
        INVALID_QUANTITY: {
          message: "مقدار یکی از اقلام فاکتور معتبر نیست.",
          status: 400,
        },
        INVALID_PURCHASE_TOTAL: {
          message: "مبلغ کل اقلام فاکتور خرید معتبر نیست.",
          status: 400,
        },
        INVALID_PURCHASE_DISCOUNT: {
          message: "تخفیف فاکتور خرید نمی‌تواند از مبلغ اقلام بیشتر باشد.",
          status: 400,
        },
        INVALID_ACQUISITION_COST: {
          message: "بهای تمام‌شده خرید نمی‌تواند منفی باشد.",
          status: 400,
        },
        INVALID_ALLOCATION: {
          message: "تقسیم هزینه بین اقلام فاکتور امکان‌پذیر نیست.",
          status: 400,
        },
        INVENTORY_VALUE_OVERFLOW: {
          message: "ارزش موجودی از محدوده مجاز سامانه بیشتر است.",
          status: 400,
        },
        STOCK_CONFLICT: {
          message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید.",
          status: 409,
        },
      };

      const known = knownErrors[error.message];

      if (known) {
        return NextResponse.json(
          { message: known.message },
          { status: known.status }
        );
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return NextResponse.json(
          { message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید." },
          { status: 409 }
        );
      }
    }

    console.error("Issue invoice error:", error);

    return NextResponse.json(
      { message: "خطا در صدور فاکتور." },
      { status: 500 }
    );
  }
}