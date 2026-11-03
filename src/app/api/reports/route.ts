import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getMonthStart(date: Date, offset = 0) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
  );
}

function serializeAmount(value: bigint | null | undefined) {
  return (value ?? BigInt(0)).toString();
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (user.role !== "BUSINESS_OWNER" || !user.business) {
      return NextResponse.json(
        { error: "گزارش‌ها برای این حساب در دسترس نیست." },
        { status: 403 }
      );
    }

    const businessId = user.business.id;
    const now = new Date();
    const url = new URL(request.url);

    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : getMonthStart(now);
    const to = toParam ? new Date(toParam) : now;

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      return NextResponse.json(
        { error: "بازه زمانی نامعتبر است." },
        { status: 400 }
      );
    }

    const endExclusive = new Date(to.getTime() + 1);

    const [
      sales,
      purchases,
      receipts,
      payments,
      expenses,
      salesInvoices,
      monthlyPurchases,
      monthlyReceipts,
      monthlyPayments,
      monthlyExpenses,
      business,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          businessId,
          type: "SALE",
          status: "ISSUED",
          issuedAt: { gte: from, lt: endExclusive },
        },
        _sum: { total: true },
        _count: { id: true },
      }),

      prisma.invoice.aggregate({
        where: {
          businessId,
          type: "PURCHASE",
          status: "ISSUED",
          issuedAt: { gte: from, lt: endExclusive },
        },
        _sum: { total: true },
        _count: { id: true },
      }),

      prisma.payment.aggregate({
        where: {
          businessId,
          type: "RECEIPT",
          status: "CONFIRMED",
          paidAt: { gte: from, lt: endExclusive },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),

      prisma.payment.aggregate({
        where: {
          businessId,
          type: "PAYMENT",
          status: "CONFIRMED",
          paidAt: { gte: from, lt: endExclusive },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),

      prisma.expense.aggregate({
        where: {
          businessId,
          status: "CONFIRMED",
          spentAt: { gte: from, lt: endExclusive },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),

      prisma.invoice.findMany({
        where: {
          businessId,
          type: "SALE",
          status: "ISSUED",
          issuedAt: { gte: from, lt: endExclusive },
        },
        select: {
          total: true,
          issuedAt: true,
          costingRecordedAt: true,
          items: {
            select: {
              costOfGoodsSold: true,
            },
          },
        },
        orderBy: {
          issuedAt: "asc",
        },
      }),

      prisma.invoice.findMany({
        where: {
          businessId,
          type: "PURCHASE",
          status: "ISSUED",
          issuedAt: { gte: from, lt: endExclusive },
        },
        select: {
          total: true,
          issuedAt: true,
        },
      }),

      prisma.payment.findMany({
        where: {
          businessId,
          type: "RECEIPT",
          status: "CONFIRMED",
          paidAt: { gte: from, lt: endExclusive },
        },
        select: {
          amount: true,
          paidAt: true,
        },
      }),

      prisma.payment.findMany({
        where: {
          businessId,
          type: "PAYMENT",
          status: "CONFIRMED",
          paidAt: { gte: from, lt: endExclusive },
        },
        select: {
          amount: true,
          paidAt: true,
        },
      }),

      prisma.expense.findMany({
        where: {
          businessId,
          status: "CONFIRMED",
          spentAt: { gte: from, lt: endExclusive },
        },
        select: {
          amount: true,
          spentAt: true,
        },
      }),

      prisma.business.findUnique({
        where: { id: businessId },
        select: { currencyUnit: true },
      }),
    ]);

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    let costedSalesAmount = BigInt(0);
    let costOfGoodsSold = BigInt(0);
    let uncostedSalesAmount = BigInt(0);
    let uncostedSales = BigInt(0);
    let costedSalesCount = 0;
    let uncostedSalesCount = 0;
    let grossProfit = BigInt(0);

    const monthlyMap = new Map<
      string,
      {
        sales: bigint;
        purchases: bigint;
        receipts: bigint;
        payments: bigint;
        expenses: bigint;
        costOfGoodsSold: bigint;
        grossProfit: bigint;
        uncostedSales: bigint;
      }
    >();

    function ensureMonth(date: Date) {
      const key = `${date.getUTCFullYear()}-${String(
        date.getUTCMonth() + 1
      ).padStart(2, "0")}`;

      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, {
          sales: BigInt(0),
          purchases: BigInt(0),
          receipts: BigInt(0),
          payments: BigInt(0),
          expenses: BigInt(0),
          costOfGoodsSold: BigInt(0),
          grossProfit: BigInt(0),
          uncostedSales: BigInt(0),
        });
      }

      return monthlyMap.get(key)!;
    }

    function addToMonth(
      date: Date | null,
      field: keyof ReturnType<typeof ensureMonth>,
      amount: bigint
    ) {
      if (!date) return;

      const month = ensureMonth(date);
      month[field] += amount;
    }

    // فروش، بهای تمام‌شده و سود ناخالص
    for (const invoice of salesInvoices) {
      if (!invoice.issuedAt) continue;

      const month = ensureMonth(invoice.issuedAt);

      // تمام فروش‌ها در فروش کل لحاظ می‌شوند.
      month.sales += invoice.total;

      // فقط فاکتورهایی که بهای تمام‌شده آن‌ها
      // در زمان صدور با موفقیت ثبت شده است.
      if (!invoice.costingRecordedAt) {
        uncostedSales += invoice.total;
        uncostedSalesCount += 1;
        month.uncostedSales += invoice.total;
        continue;
      }

      const invoiceCost = invoice.items.reduce(
        (sum, item) => sum + item.costOfGoodsSold,
        BigInt(0)
      );

      const invoiceGrossProfit = invoice.total - invoiceCost;

      costedSalesAmount += invoice.total;
      costedSalesCount += 1;
      costOfGoodsSold += invoiceCost;
      grossProfit += invoiceGrossProfit;

      month.costOfGoodsSold += invoiceCost;
      month.grossProfit += invoiceGrossProfit;
    }

    // فاکتورهای خرید
    for (const item of monthlyPurchases) {
      addToMonth(item.issuedAt, "purchases", item.total);
    }

    // دریافت‌ها
    for (const item of monthlyReceipts) {
      addToMonth(item.paidAt, "receipts", item.amount);
    }

    // پرداخت‌ها
    for (const item of monthlyPayments) {
      addToMonth(item.paidAt, "payments", item.amount);
    }

    // هزینه‌ها
    for (const item of monthlyExpenses) {
      addToMonth(item.spentAt, "expenses", item.amount);
    }

    const monthlyPerformance = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({
        month,
        sales: serializeAmount(values.sales),
        purchases: serializeAmount(values.purchases),
        receipts: serializeAmount(values.receipts),
        payments: serializeAmount(values.payments),
        expenses: serializeAmount(values.expenses),
        costOfGoodsSold: serializeAmount(values.costOfGoodsSold),
        grossProfit: serializeAmount(values.grossProfit),
        uncostedSales: serializeAmount(values.uncostedSales),
      }));

    return NextResponse.json({
      currencyUnit: business.currencyUnit,

      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },

      summary: {
        sales: {
          amount: serializeAmount(sales._sum.total),
          count: sales._count.id,
        },

        purchases: {
          amount: serializeAmount(purchases._sum.total),
          count: purchases._count.id,
        },

        receipts: {
          amount: serializeAmount(receipts._sum.amount),
          count: receipts._count.id,
        },

        payments: {
          amount: serializeAmount(payments._sum.amount),
          count: payments._count.id,
        },

        expenses: {
          amount: serializeAmount(expenses._sum.amount),
          count: expenses._count.id,
        },

        costedSales: {
          amount: serializeAmount(costedSalesAmount),
          count: costedSalesCount,
        },

        costOfGoodsSold: {
          amount: serializeAmount(costOfGoodsSold),
        },

        grossProfit: {
          amount: serializeAmount(grossProfit),
        },

        uncostedSales: {
          amount: serializeAmount(uncostedSales),
          count: uncostedSalesCount,
        },
      },

      costing: {
        hasUncostedSales: uncostedSalesCount > 0,
      },

      monthlyPerformance,
    });
  } catch (error) {
    console.error("REPORTS_API_ERROR:", error);

    return NextResponse.json(
      { error: "دریافت گزارش‌های مالی ناموفق بود." },
      { status: 500 }
    );
  }
}