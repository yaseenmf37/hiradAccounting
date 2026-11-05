import { NextRequest, NextResponse } from "next/server";
import {
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

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
            purchaseReturns: { select: { id: true } },
            payments: {
              where: {
                status: PaymentStatus.CONFIRMED,
              },
              select: {
                id: true,
                amount: true,
              },
            },
          },
        });

        if (!invoice) throw new Error("INVOICE_NOT_FOUND");
        if (invoice.status !== "ISSUED") {
          throw new Error("INVOICE_NOT_ISSUED");
        }
        if (invoice.items.length === 0) {
          throw new Error("INVOICE_EMPTY");
        }
        if (invoice.payments.length > 0) {
          throw new Error("INVOICE_HAS_PAYMENTS");
        }
        if (!invoice.issuedAt) {
          throw new Error("INVOICE_ISSUE_DATE_MISSING");
        }
        if (invoice.type === "PURCHASE" && invoice.purchaseReturns.length > 0) {
          throw new Error("PURCHASE_HAS_RETURNS");
        }
        if (invoice.type === "SALE") {
          const salesReturns = await tx.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) AS count
            FROM "SalesReturn"
            WHERE "invoiceId" = ${invoice.id} AND "businessId" = ${businessId}
          `;
          if ((salesReturns[0]?.count ?? 0n) > 0n) {
            throw new Error("SALE_HAS_RETURNS");
          }
        }

        const groupedItems = new Map<
          string,
          {
            quantity: Prisma.Decimal;
            costOfGoodsSold: bigint;
          }
        >();

        for (const item of invoice.items) {
          const current = groupedItems.get(item.productId);

          if (current) {
            current.quantity = current.quantity.add(item.quantity);
            current.costOfGoodsSold += item.costOfGoodsSold;
          } else {
            groupedItems.set(item.productId, {
              quantity: new Prisma.Decimal(item.quantity),
              costOfGoodsSold: item.costOfGoodsSold,
            });
          }
        }

        // لغو خرید فقط زمانی مجاز است که هیچ گردش بعدی روی کالاها نباشد.
        if (invoice.type === "PURCHASE") {
          const productIds = [...groupedItems.keys()];
          const firstPurchaseMovement = await tx.inventoryMovement.findFirst({
            where: {
              businessId,
              invoiceId: invoice.id,
              type: "PURCHASE",
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { createdAt: true },
          });
          if (!firstPurchaseMovement) {
            throw new Error("ORIGINAL_MOVEMENT_NOT_FOUND");
          }

          const laterMovement = await tx.inventoryMovement.findFirst({
            where: {
              businessId,
              productId: { in: productIds },
              createdAt: { gte: firstPurchaseMovement.createdAt },
              OR: [
                { invoiceId: null },
                { invoiceId: { not: invoice.id } },
              ],
            },
            select: {
              id: true,
            },
          });

          if (laterMovement) {
            throw new Error("PURCHASE_HAS_LATER_MOVEMENTS");
          }
        }

        for (const [productId, data] of groupedItems) {
          const product = await tx.product.findFirst({
            where: {
              id: productId,
              businessId,
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
            // برگشت دقیق ارزش خرید قبلی
            const originalPurchaseMovement =
              await tx.inventoryMovement.findFirst({
                where: {
                  businessId,
                  productId,
                  invoiceId: invoice.id,
                  type: "PURCHASE",
                },
                select: {
                  totalCost: true,
                  quantity: true,
                },
              });

            if (!originalPurchaseMovement) {
              throw new Error("ORIGINAL_MOVEMENT_NOT_FOUND");
            }

            if (product.stock.lessThan(data.quantity)) {
              throw new Error("INSUFFICIENT_STOCK_TO_CANCEL");
            }

            totalCost = originalPurchaseMovement.totalCost;
            newStock = product.stock.sub(data.quantity);

            if (product.inventoryValue < totalCost) {
              throw new Error("INVALID_INVENTORY_VALUE");
            }

            newInventoryValue = product.inventoryValue - totalCost;

            newAverageCost = newStock.isZero()
              ? new Prisma.Decimal(0)
              : new Prisma.Decimal(
                  newInventoryValue.toString()
                ).div(newStock);
          } else {
            // برگشت فروش با بهای تمام‌شده تاریخی
            totalCost = data.costOfGoodsSold;

            newStock = product.stock.add(data.quantity);
            newInventoryValue = product.inventoryValue + totalCost;

            newAverageCost = new Prisma.Decimal(
              newInventoryValue.toString()
            ).div(newStock);
          }

          const updated = await tx.product.updateMany({
            where: {
              id: productId,
              businessId,
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

          if (updated.count !== 1) {
            throw new Error("STOCK_CONFLICT");
          }

          await tx.inventoryMovement.create({
            data: {
              businessId,
              productId,
              invoiceId: invoice.id,
              type:
                invoice.type === "PURCHASE"
                  ? "ADJUSTMENT_OUT"
                  : "RETURN_IN",
              quantity: data.quantity,
              totalCost,
              averageCost: newAverageCost,
              description: `لغو فاکتور ${invoice.invoiceNumber}`,
            },
          });
        }

        const cancelled = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            businessId,
            status: "ISSUED",
          },
          data: {
            status: "CANCELLED",
          },
        });

        if (cancelled.count !== 1) {
          throw new Error("INVOICE_ALREADY_CANCELLED");
        }

        return tx.invoice.findFirst({
          where: {
            id: invoice.id,
            businessId,
          },
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
      message: "فاکتور با موفقیت لغو شد.",
      invoice: result
        ? {
            ...result,
            total: result.total.toString(),
          }
        : null,
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
        INVOICE_NOT_ISSUED: {
          message: "فقط فاکتور صادرشده قابل لغو است.",
          status: 409,
        },
        INVOICE_EMPTY: {
          message: "فاکتور هیچ کالایی ندارد.",
          status: 400,
        },
        INVOICE_HAS_PAYMENTS: {
          message:
            "این فاکتور پرداخت تأییدشده دارد. ابتدا باید وضعیت مالی آن تعیین تکلیف شود.",
          status: 409,
        },
        PRODUCT_NOT_FOUND: {
          message: "یکی از کالاهای فاکتور پیدا نشد.",
          status: 404,
        },
        INSUFFICIENT_STOCK_TO_CANCEL: {
          message: "موجودی فعلی برای لغو این فاکتور خرید کافی نیست.",
          status: 409,
        },
        INVOICE_ALREADY_CANCELLED: {
          message: "این فاکتور قبلاً لغو شده است.",
          status: 409,
        },
        PURCHASE_HAS_LATER_MOVEMENTS: {
          message:
            "پس از این خرید برای یکی از کالاها گردش دیگری ثبت شده است؛ لغو خرید برای حفظ دقت بهای تمام‌شده امکان‌پذیر نیست.",
          status: 409,
        },
        PURCHASE_HAS_RETURNS: {
          message: "فاکتور خرید دارای مرجوعی است؛ برای حفظ سوابق، ابتدا مرجوعی باید در مسیر اصلاحی جداگانه تعیین تکلیف شود.",
          status: 409,
        },
        SALE_HAS_RETURNS: {
          message: "فاکتور فروش دارای مرجوعی است؛ برای حفظ سوابق، لغو مستقیم آن مجاز نیست.",
          status: 409,
        },
        INVOICE_ISSUE_DATE_MISSING: {
          message: "تاریخ صدور فاکتور معتبر نیست.",
          status: 409,
        },
        ORIGINAL_MOVEMENT_NOT_FOUND: {
          message: "گردش اولیه خرید پیدا نشد؛ امکان لغو دقیق وجود ندارد.",
          status: 409,
        },
        INVALID_INVENTORY_VALUE: {
          message: "ارزش موجودی برای برگشت این خرید کافی نیست.",
          status: 409,
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

    console.error("Cancel invoice error:", error);

    return NextResponse.json(
      { message: "خطا در لغو فاکتور." },
      { status: 500 }
    );
  }
}