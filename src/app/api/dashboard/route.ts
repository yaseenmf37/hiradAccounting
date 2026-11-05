
import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getMonthStart(date: Date, offset = 0) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
  );
}

function percentageChange(current: bigint, previous: bigint) {
  if (previous === 0n) return null;

  const percentage =
    Number(((current - previous) * 10000n) / previous) / 100;

  return Number.isFinite(percentage) ? percentage : null;
}

export async function GET() {
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
        { error: "اطلاعات داشبورد برای این حساب در دسترس نیست." },
        { status: 403 }
      );
    }

    const businessId = user.business.id;
    const now = new Date();

    const currentMonth = getMonthStart(now);
    const previousMonth = getMonthStart(now, -1);
    const eightMonthsAgo = getMonthStart(now, -7);

    const [
      currentInvoices,
      previousInvoices,
      currentPurchaseReturns,
      previousPurchaseReturns,
      currentSalesReturns,
      previousSalesReturns,
      currentExpenses,
      previousExpenses,
      productCount,
      monthlyInvoices,
      monthlySalesReturns,
      recentInvoices,
    ] = await Promise.all([
      prisma.invoice.groupBy({
        by: ["type"],
        where: {
          businessId,
          status: "ISSUED",
          invoiceDate: { gte: currentMonth },
        },
        _sum: { total: true },
      }),

      prisma.invoice.groupBy({
        by: ["type"],
        where: {
          businessId,
          status: "ISSUED",
          invoiceDate: {
            gte: previousMonth,
            lt: currentMonth,
          },
        },
        _sum: { total: true },
      }),

      prisma.purchaseReturn.aggregate({
        where: { businessId, createdAt: { gte: currentMonth } },
        _sum: { total: true },
      }),

      prisma.purchaseReturn.aggregate({
        where: { businessId, createdAt: { gte: previousMonth, lt: currentMonth } },
        _sum: { total: true },
      }),

      prisma.$queryRaw<{ amount: bigint }[]>`
        SELECT COALESCE(SUM("total"), 0) AS amount
        FROM "SalesReturn"
        WHERE "businessId" = ${businessId} AND "createdAt" >= ${currentMonth}
      `,

      prisma.$queryRaw<{ amount: bigint }[]>`
        SELECT COALESCE(SUM("total"), 0) AS amount
        FROM "SalesReturn"
        WHERE "businessId" = ${businessId}
          AND "createdAt" >= ${previousMonth} AND "createdAt" < ${currentMonth}
      `,

      prisma.expense.aggregate({
        where: {
          businessId,
          status: "CONFIRMED",
          spentAt: { gte: currentMonth },
        },
        _sum: { amount: true },
      }),

      prisma.expense.aggregate({
        where: {
          businessId,
          status: "CONFIRMED",
          spentAt: {
            gte: previousMonth,
            lt: currentMonth,
          },
        },
        _sum: { amount: true },
      }),

      prisma.product.count({
        where: {
          businessId,
          isActive: true,
        },
      }),

      prisma.$queryRaw<{ month: string; total: bigint }[]>`
        SELECT
          to_char(
            date_trunc('month', "invoiceDate"),
            'YYYY-MM'
          ) AS "month",
          SUM("total") AS "total"
        FROM "Invoice"
        WHERE "businessId" = ${businessId}
          AND "type" = 'SALE'
          AND "status" = 'ISSUED'
          AND "invoiceDate" >= ${eightMonthsAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `,

      prisma.$queryRaw<{ month: string; total: bigint }[]>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS "month",
          SUM("total") AS "total"
        FROM "SalesReturn"
        WHERE "businessId" = ${businessId} AND "createdAt" >= ${eightMonthsAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `,

      prisma.invoice.findMany({
        where: { businessId },
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          status: true,
          total: true,
          createdAt: true,
          invoiceDate: true,
          contact: {
            select: { name: true },
          },
          payments: {
            where: { status: "CONFIRMED" },
            select: {
              amount: true,
              type: true,
              method: true,
            },
          },
        },
        orderBy: { invoiceDate: "desc" },
        take: 5,
      }),
    ]);

    const getInvoiceTotal = (
      rows: typeof currentInvoices,
      type: "SALE" | "PURCHASE"
    ) =>
      rows.find((row) => row.type === type)?._sum.total ?? 0n;

    const currentSales = getInvoiceTotal(currentInvoices, "SALE") -
      (currentSalesReturns[0]?.amount ?? 0n);
    const previousSales = getInvoiceTotal(previousInvoices, "SALE") -
      (previousSalesReturns[0]?.amount ?? 0n);
    const currentPurchases =
      getInvoiceTotal(currentInvoices, "PURCHASE") -
      (currentPurchaseReturns._sum.total ?? 0n);
    const previousPurchases =
      getInvoiceTotal(previousInvoices, "PURCHASE") -
      (previousPurchaseReturns._sum.total ?? 0n);

    const currentExpenseTotal = currentExpenses._sum.amount ?? 0n;
    const previousExpenseTotal = previousExpenses._sum.amount ?? 0n;

    const salesByMonth = new Map<string, bigint>();

    for (let i = 0; i < 8; i++) {
      const month = getMonthStart(now, i - 7);
      const key = `${month.getUTCFullYear()}-${month.getUTCMonth()}`;
      salesByMonth.set(key, 0n);
    }

    for (const invoice of monthlyInvoices) {
      const [year, month] = invoice.month.split("-").map(Number);
      const key = `${year}-${month - 1}`;

      salesByMonth.set(
        key,
        (salesByMonth.get(key) ?? 0n) + invoice.total
      );
    }
    for (const salesReturn of monthlySalesReturns) {
      const [year, month] = salesReturn.month.split("-").map(Number);
      const key = `${year}-${month - 1}`;
      salesByMonth.set(key, (salesByMonth.get(key) ?? 0n) - salesReturn.total);
    }

    const salesTrend = Array.from(salesByMonth.entries()).map(
      ([key, total]) => {
        const [year, month] = key.split("-").map(Number);
        const date = new Date(Date.UTC(year, month, 1));

        return {
          month: new Intl.DateTimeFormat("fa-IR", {
            month: "short",
            timeZone: "UTC",
          }).format(date),
          sales: Number(total),
        };
      }
    );

    const serializedInvoices = recentInvoices.map((invoice) => {
      const expectedPaymentType =
        invoice.type === "SALE" ? "RECEIPT" : "PAYMENT";

      const paidAmount = invoice.payments.reduce(
        (sum, payment) =>
          payment.type === expectedPaymentType && payment.method !== "LEDGER"
            ? sum + payment.amount
            : sum,
        0n
      );

      let paymentStatus = "UNPAID";

      if (invoice.status === "DRAFT") {
        paymentStatus = "DRAFT";
      } else if (invoice.status === "CANCELLED") {
        paymentStatus = "CANCELLED";
      } else if (paidAmount >= invoice.total) {
        paymentStatus = "PAID";
      } else if (paidAmount > 0n) {
        paymentStatus = "PARTIAL";
      }

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        type: invoice.type,
        status: paymentStatus,
        amount: invoice.total.toString(),
        contactName: invoice.contact?.name ?? "بدون طرف حساب",
        date: invoice.invoiceDate.toISOString(),
      };
    });

    return NextResponse.json({
      currencyUnit: user.business.currencyUnit,

      stats: {
        sales: currentSales.toString(),
        purchases: currentPurchases.toString(),
        expenses: currentExpenseTotal.toString(),
        productCount,

        salesChange: percentageChange(
          currentSales,
          previousSales
        ),

        purchasesChange: percentageChange(
          currentPurchases,
          previousPurchases
        ),

        expensesChange: percentageChange(
          currentExpenseTotal,
          previousExpenseTotal
        ),
      },

      salesTrend,
      recentInvoices: serializedInvoices,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("DASHBOARD_API_ERROR:", error);

    return NextResponse.json(
      { error: "دریافت اطلاعات داشبورد ناموفق بود." },
      { status: 500 }
    );
  }
}
