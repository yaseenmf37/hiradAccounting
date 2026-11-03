
import { NextResponse } from "next/server";
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
      currentExpenses,
      previousExpenses,
      productCount,
      monthlyInvoices,
      recentInvoices,
    ] = await Promise.all([
      prisma.invoice.groupBy({
        by: ["type"],
        where: {
          businessId,
          status: "ISSUED",
          issuedAt: { gte: currentMonth },
        },
        _sum: { total: true },
      }),

      prisma.invoice.groupBy({
        by: ["type"],
        where: {
          businessId,
          status: "ISSUED",
          issuedAt: {
            gte: previousMonth,
            lt: currentMonth,
          },
        },
        _sum: { total: true },
      }),

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

      prisma.invoice.findMany({
        where: {
          businessId,
          type: "SALE",
          status: "ISSUED",
          issuedAt: { gte: eightMonthsAgo },
        },
        select: {
          total: true,
          issuedAt: true,
        },
        orderBy: { issuedAt: "asc" },
      }),

      prisma.invoice.findMany({
        where: { businessId },
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          status: true,
          total: true,
          createdAt: true,
          issuedAt: true,
          contact: {
            select: { name: true },
          },
          payments: {
            where: { status: "CONFIRMED" },
            select: {
              amount: true,
              type: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const getInvoiceTotal = (
      rows: typeof currentInvoices,
      type: "SALE" | "PURCHASE"
    ) =>
      rows.find((row) => row.type === type)?._sum.total ?? 0n;

    const currentSales = getInvoiceTotal(currentInvoices, "SALE");
    const previousSales = getInvoiceTotal(previousInvoices, "SALE");
    const currentPurchases = getInvoiceTotal(currentInvoices, "PURCHASE");
    const previousPurchases = getInvoiceTotal(previousInvoices, "PURCHASE");

    const currentExpenseTotal = currentExpenses._sum.amount ?? 0n;
    const previousExpenseTotal = previousExpenses._sum.amount ?? 0n;

    const salesByMonth = new Map<string, bigint>();

    for (let i = 0; i < 8; i++) {
      const month = getMonthStart(now, i - 7);
      const key = `${month.getUTCFullYear()}-${month.getUTCMonth()}`;
      salesByMonth.set(key, 0n);
    }

    for (const invoice of monthlyInvoices) {
      if (!invoice.issuedAt) continue;

      const key = `${invoice.issuedAt.getUTCFullYear()}-${invoice.issuedAt.getUTCMonth()}`;

      salesByMonth.set(
        key,
        (salesByMonth.get(key) ?? 0n) + invoice.total
      );
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
          payment.type === expectedPaymentType
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
        date: (invoice.issuedAt ?? invoice.createdAt).toISOString(),
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
    console.error("DASHBOARD_API_ERROR:", error);

    return NextResponse.json(
      { error: "دریافت اطلاعات داشبورد ناموفق بود." },
      { status: 500 }
    );
  }
}
