import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

async function getBusiness() {
  const user = await getCurrentUser();
  if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) return null;
  return user.business.id;
}

export async function GET(request: NextRequest) {
  try {
    const businessId = await getBusiness();
    if (!businessId) return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    const pagination = parseCursorPageParams(request.nextUrl.searchParams);
    if (!pagination) {
      return NextResponse.json({ message: "محدوده صفحه‌بندی معتبر نیست." }, { status: 400 });
    }

    const where: Prisma.ProductWhereInput = {
      businessId,
      stock: { lt: 0 },
    };
    const [rows, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          unit: true,
          stock: true,
        },
        orderBy: { id: "asc" },
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
      }),
      prisma.product.count({ where }),
    ]);
    const page = getCursorPage(rows, pagination.limit);
    return NextResponse.json({
      backorders: page.items.map((entry) => ({
        id: entry.id,
        product: {
          name: entry.name,
          unit: entry.unit,
          stock: entry.stock.toString(),
        },
        shortage: entry.stock.abs().toString(),
      })),
      total,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    console.error("GET /api/backorders:", error);
    return NextResponse.json({ message: "دریافت کسری سفارش‌ها انجام نشد." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = await getBusiness();
    if (!businessId) return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    const parsed = z.object({
      backorderId: z.string().min(1),
      quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
    }).safeParse(await request.json());
    if (!parsed.success || new Prisma.Decimal(parsed.success ? parsed.data.quantity : "0").lessThanOrEqualTo(0)) {
      return NextResponse.json({ message: "مقدار تخصیص معتبر نیست." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const backorder = await tx.backorder.findFirst({
        where: { id: parsed.data.backorderId, businessId, cancelledAt: null },
        include: {
          product: { select: { id: true, stock: true, averageCost: true, inventoryValue: true } },
          invoice: { select: { id: true, type: true, status: true, invoiceNumber: true } },
          invoiceItem: {
            select: {
              id: true,
              quantity: true,
              costOfGoodsSold: true,
              costedQuantity: true,
            },
          },
        },
      });
      if (!backorder) throw new Error("BACKORDER_NOT_FOUND");
      if (!backorder.invoiceItem) throw new Error("BACKORDER_ITEM_REPLACED");
      if (backorder.invoice.type !== "SALE" || backorder.invoice.status !== "ISSUED") throw new Error("BACKORDER_NOT_ACTIVE");
      if (backorder.inventoryDeducted) throw new Error("NEGATIVE_STOCK_BACKORDER_AUTO_ALLOCATED");

      const requested = new Prisma.Decimal(parsed.data.quantity);
      if (requested.greaterThan(backorder.outstanding)) throw new Error("BACKORDER_OVER_ALLOCATION");
      if (requested.greaterThan(backorder.product.stock)) throw new Error("BACKORDER_STOCK_INSUFFICIENT");

      const stock = backorder.product.stock.sub(requested);
      const calculatedCost = requested.equals(backorder.product.stock)
        ? backorder.product.inventoryValue
        : BigInt(backorder.product.averageCost.mul(requested).toFixed(0, Prisma.Decimal.ROUND_HALF_UP));
      const cost = calculatedCost > backorder.product.inventoryValue
        ? backorder.product.inventoryValue
        : calculatedCost;
      const inventoryValue = backorder.product.inventoryValue - cost;
      const averageCost = stock.greaterThan(0)
        ? new Prisma.Decimal(inventoryValue.toString()).div(stock)
        : new Prisma.Decimal(0);
      const productUpdated = await tx.product.updateMany({
        where: {
          id: backorder.product.id,
          businessId,
          stock: backorder.product.stock,
          inventoryValue: backorder.product.inventoryValue,
          averageCost: backorder.product.averageCost,
        },
        data: { stock, inventoryValue, averageCost },
      });
      if (productUpdated.count !== 1) throw new Error("STOCK_CONFLICT");

      const updated = await tx.backorder.updateMany({
        where: {
          id: backorder.id,
          outstanding: backorder.outstanding,
          cancelledAt: null,
        },
        data: {
          fulfilled: { increment: requested },
          outstanding: { decrement: requested },
        },
      });
      if (updated.count !== 1) throw new Error("BACKORDER_CONFLICT");

      const itemUpdated = await tx.invoiceItem.updateMany({
        where: {
          id: backorder.invoiceItem.id,
          quantity: backorder.invoiceItem.quantity,
          costedQuantity: backorder.invoiceItem.costedQuantity,
        },
        data: {
          costOfGoodsSold: { increment: cost },
          costedQuantity: { increment: requested },
        },
      });
      if (itemUpdated.count !== 1) throw new Error("BACKORDER_CONFLICT");
      const movement = await tx.inventoryMovement.create({
        data: {
          businessId,
          productId: backorder.product.id,
          invoiceId: backorder.invoice.id,
          type: "SALE",
          quantity: requested,
          totalCost: cost,
          averageCost,
          description: `تأمین کسری فاکتور ${backorder.invoice.invoiceNumber}`,
        },
      });
      await tx.backorderAllocation.create({
        data: {
          backorderId: backorder.id,
          quantity: requested,
          totalCost: cost,
          inventoryMovementId: movement.id,
        },
      });
      const [remainingBackorders, items] = await Promise.all([
        tx.backorder.count({
          where: {
            invoiceId: backorder.invoice.id,
            cancelledAt: null,
            outstanding: { gt: 0 },
            invoice: { is: { type: "SALE", status: "ISSUED" } },
          },
        }),
        tx.invoiceItem.findMany({
          where: { invoiceId: backorder.invoice.id },
          select: { quantity: true, costedQuantity: true },
        }),
      ]);
      if (
        remainingBackorders === 0 &&
        items.every((item) => item.costedQuantity.greaterThanOrEqualTo(item.quantity))
      ) {
        await tx.invoice.updateMany({
          where: {
            id: backorder.invoice.id,
            businessId,
            type: "SALE",
            status: "ISSUED",
          },
          data: { costingRecordedAt: new Date() },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ message: "موجودی با موفقیت به کسری سفارش تخصیص یافت." });
  } catch (error) {
    const messages: Record<string, { message: string; status: number }> = {
      BACKORDER_NOT_FOUND: { message: "کسری سفارش پیدا نشد.", status: 404 },
      BACKORDER_NOT_ACTIVE: { message: "فاکتور دارای کسری فعال نیست.", status: 409 },
      BACKORDER_ITEM_REPLACED: { message: "قلم فاکتور ویرایش شده و این کسری نیازمند بازبینی دستی است.", status: 409 },
      BACKORDER_OVER_ALLOCATION: { message: "مقدار تخصیص از کسری سفارش بیشتر است.", status: 400 },
      BACKORDER_STOCK_INSUFFICIENT: { message: "موجودی فعلی برای این تخصیص کافی نیست.", status: 409 },
      NEGATIVE_STOCK_BACKORDER_AUTO_ALLOCATED: { message: "کسری ثبت‌شده در موجودی منفی، با ورود موجودی به‌صورت خودکار تسویه می‌شود.", status: 409 },
      STOCK_CONFLICT: { message: "موجودی هم‌زمان تغییر کرده؛ دوباره تلاش کنید.", status: 409 },
      BACKORDER_CONFLICT: { message: "کسری سفارش هم‌زمان تغییر کرده؛ دوباره تلاش کنید.", status: 409 },
    };
    if (error instanceof Error && messages[error.message]) {
      return NextResponse.json(messages[error.message], { status: messages[error.message].status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ message: "تخصیص هم‌زمان انجام شده؛ فهرست را تازه‌سازی کنید." }, { status: 409 });
    }
    console.error("POST /api/backorders:", error);
    return NextResponse.json({ message: "تخصیص موجودی انجام نشد." }, { status: 500 });
  }
}
