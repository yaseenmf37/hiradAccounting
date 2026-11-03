import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

type InvoiceItemData = {
  id: string;
  productId: string;
  quantity: Prisma.Decimal;
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

export async function POST(
  _request: NextRequest,
  context: RouteContext
) {
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
          include: {
            items: true,
          },
        });

        if (!invoice) throw new Error("INVOICE_NOT_FOUND");
        if (invoice.status !== "DRAFT") {
          throw new Error("INVOICE_NOT_DRAFT");
        }
        if (invoice.items.length === 0) {
          throw new Error("INVOICE_EMPTY");
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

            newStock = product.stock.add(group.quantity);
            newInventoryValue = product.inventoryValue + totalCost;

            newAverageCost = new Prisma.Decimal(
              newInventoryValue.toString()
            ).div(newStock);
          } else {
            if (product.stock.lessThan(group.quantity)) {
              throw new Error("INSUFFICIENT_STOCK");
            }

            newStock = product.stock.sub(group.quantity);

            // در صورت خروج تمام موجودی، ارزش دقیق باقی‌مانده صفر می‌شود
            totalCost = group.quantity.equals(product.stock)
              ? product.inventoryValue
              : BigInt(
                  product.averageCost
                    .mul(group.quantity)
                    .toFixed(0, Prisma.Decimal.ROUND_HALF_UP)
                );

            if (totalCost > product.inventoryValue) {
              totalCost = product.inventoryValue;
            }

            newInventoryValue = product.inventoryValue - totalCost;

            newAverageCost = newStock.isZero()
              ? new Prisma.Decimal(0)
              : new Prisma.Decimal(newInventoryValue.toString()).div(
                  newStock
                );

            // تخصیص بهای تمام‌شده فروش بین ردیف‌های همان کالا
            const itemCosts = allocateAmount(
              totalCost,
              group.items.map((item) =>
                BigInt(
                  item.quantity
                    .mul(1_000_000)
                    .toFixed(0, Prisma.Decimal.ROUND_HALF_UP)
                )
              )
            );

            for (let i = 0; i < group.items.length; i++) {
              await tx.invoiceItem.update({
                where: { id: group.items[i].id },
                data: {
                  costOfGoodsSold: itemCosts[i],
                },
              });
            }
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
          await tx.inventoryMovement.create({
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
            costingRecordedAt:
              invoice.type === "SALE" ? issuedAt : null,
          },
        });

        if (issued.count !== 1) {
          throw new Error("INVOICE_ALREADY_ISSUED");
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
        PRODUCT_NOT_FOUND: {
          message: "یک یا چند کالا دیگر معتبر یا فعال نیستند.",
          status: 400,
        },
        INSUFFICIENT_STOCK: {
          message: "موجودی یک یا چند کالا برای صدور فاکتور کافی نیست.",
          status: 409,
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