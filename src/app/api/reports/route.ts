import { NextRequest, NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
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

    const [monthlyRows, business] = await Promise.all([
      prisma.$queryRaw<{
        month: string;
        sales: string;
        salesCount: string;
        salesReturnCount: string;
        costedSales: string;
        costedSalesCount: string;
        uncostedSales: string;
        uncostedSalesCount: string;
        partiallyCostedSalesCount: string;
        recognizedCostOfGoodsSold: string;
        purchases: string;
        purchaseCount: string;
        purchaseReturnCount: string;
        receipts: string;
        receiptCount: string;
        payments: string;
        paymentCount: string;
        expenses: string;
        expenseCount: string;
      }[]>`
        WITH sales_invoices AS (
          SELECT
            i."id",
            i."invoiceDate",
            i."total",
            i."costingRecordedAt",
            COALESCE(
              CASE
                WHEN SUM(ii."total") > 0 THEN SUM(
                  ii."total"::numeric
                  * LEAST(ii."costedQuantity", ii."quantity")
                  / NULLIF(ii."quantity", 0)
                )
                ELSE SUM(LEAST(ii."costedQuantity", ii."quantity"))
              END,
              0
            ) AS "costedBasis",
            COALESCE(
              CASE
                WHEN SUM(ii."total") > 0 THEN SUM(ii."total"::numeric)
                ELSE SUM(ii."quantity")
              END,
              0
            ) AS "totalBasis"
          FROM "Invoice" i
          LEFT JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
          WHERE i."businessId" = ${businessId}
            AND i."type" = 'SALE'
            AND i."status" = 'ISSUED'
            AND i."invoiceDate" >= ${from}
            AND i."invoiceDate" < ${endExclusive}
          GROUP BY i."id", i."invoiceDate", i."total", i."costingRecordedAt"
        ),
        sales_returns_by_month AS (
          SELECT
            date_trunc('month', r."createdAt") AS month,
            SUM(r."total") AS amount,
            COUNT(*) AS count
          FROM "SalesReturn" r
          JOIN "Invoice" i ON i."id" = r."invoiceId" AND i."businessId" = r."businessId"
          WHERE r."businessId" = ${businessId}
            AND i."type" = 'SALE'
            AND r."createdAt" >= ${from}
            AND r."createdAt" < ${endExclusive}
          GROUP BY 1
        ),
        sales_gross_by_month AS (
          SELECT
            date_trunc('month', "invoiceDate") AS month,
            SUM("total") AS sales,
            COUNT(*) AS "salesCount",
            SUM(CASE WHEN "totalBasis" > 0
              THEN ROUND("total"::numeric * "costedBasis" / "totalBasis")
              ELSE 0 END) AS "costedSales",
            COUNT(*) FILTER (WHERE "costingRecordedAt" IS NOT NULL) AS "costedSalesCount",
            SUM("total" - CASE WHEN "totalBasis" > 0
              THEN ROUND("total"::numeric * "costedBasis" / "totalBasis")
              ELSE 0 END) AS "uncostedSales",
            COUNT(*) FILTER (WHERE "costedBasis" < "totalBasis") AS "uncostedSalesCount",
            COUNT(*) FILTER (
              WHERE "costedBasis" > 0 AND "costedBasis" < "totalBasis"
            ) AS "partiallyCostedSalesCount"
          FROM sales_invoices
          GROUP BY 1
        ),
        sales_by_month AS (
          SELECT
            COALESCE(gross.month, returns.month) AS month,
            COALESCE(gross.sales, 0) - COALESCE(returns.amount, 0) AS sales,
            COALESCE(returns.count, 0) AS "salesReturnCount",
            COALESCE(gross."salesCount", 0) AS "salesCount",
            COALESCE(gross."costedSales", 0) - COALESCE(returns.amount, 0) AS "costedSales",
            COALESCE(gross."costedSalesCount", 0) AS "costedSalesCount",
            COALESCE(gross."uncostedSales", 0) AS "uncostedSales",
            COALESCE(gross."uncostedSalesCount", 0) AS "uncostedSalesCount",
            COALESCE(gross."partiallyCostedSalesCount", 0) AS "partiallyCostedSalesCount"
          FROM sales_gross_by_month gross
          FULL OUTER JOIN sales_returns_by_month returns USING (month)
        ),
        cogs_by_month AS (
          SELECT
            date_trunc('month', CASE
              WHEN movement."salesReturnId" IS NOT NULL THEN movement."createdAt"
              ELSE invoice."invoiceDate"
            END) AS month,
            SUM(CASE
              WHEN movement."type" = 'SALE' THEN movement."totalCost"
              ELSE -movement."totalCost"
            END) AS cost
          FROM "InventoryMovement" movement
          JOIN "Invoice" invoice ON invoice."id" = movement."invoiceId"
          WHERE movement."businessId" = ${businessId}
            AND invoice."businessId" = ${businessId}
            AND invoice."type" = 'SALE'
            AND invoice."status" = 'ISSUED'
            AND movement."type" IN ('SALE', 'RETURN_IN')
            AND (
              (movement."salesReturnId" IS NOT NULL
                AND movement."createdAt" >= ${from}
                AND movement."createdAt" < ${endExclusive})
              OR
              (movement."salesReturnId" IS NULL
                AND invoice."invoiceDate" >= ${from}
                AND invoice."invoiceDate" < ${endExclusive})
            )
          GROUP BY 1
        ),
        purchase_activity AS (
          SELECT
            "invoiceDate" AS activity_date,
            "total" AS amount,
            false AS is_return
          FROM "Invoice"
          WHERE "businessId" = ${businessId}
            AND "type" = 'PURCHASE'
            AND "status" = 'ISSUED'
            AND "invoiceDate" >= ${from}
            AND "invoiceDate" < ${endExclusive}
          UNION ALL
          SELECT
            r."createdAt" AS activity_date,
            -r."total" AS amount,
            true AS is_return
          FROM "PurchaseReturn" r
          JOIN "Invoice" i ON i."id" = r."invoiceId"
          WHERE r."businessId" = ${businessId}
            AND i."businessId" = ${businessId}
            AND r."createdAt" >= ${from}
            AND r."createdAt" < ${endExclusive}
        ),
        purchases_by_month AS (
          SELECT
            date_trunc('month', activity_date) AS month,
            SUM(amount) AS amount,
            COUNT(*) FILTER (WHERE NOT is_return) AS count,
            COUNT(*) FILTER (WHERE is_return) AS "returnCount"
          FROM purchase_activity
          GROUP BY 1
        ),
        receipts_by_month AS (
          SELECT
            date_trunc('month', "paidAt") AS month,
            SUM("amount") AS amount,
            COUNT(*) AS count
          FROM "Payment"
          WHERE "businessId" = ${businessId}
            AND "type" = 'RECEIPT'
            AND "status" = 'CONFIRMED'
            AND "method" <> 'LEDGER'
            AND "paidAt" >= ${from}
            AND "paidAt" < ${endExclusive}
          GROUP BY 1
        ),
        payments_by_month AS (
          SELECT
            date_trunc('month', "paidAt") AS month,
            SUM("amount") AS amount,
            COUNT(*) AS count
          FROM "Payment"
          WHERE "businessId" = ${businessId}
            AND "type" = 'PAYMENT'
            AND "status" = 'CONFIRMED'
            AND "method" <> 'LEDGER'
            AND "paidAt" >= ${from}
            AND "paidAt" < ${endExclusive}
          GROUP BY 1
        ),
        expenses_by_month AS (
          SELECT
            date_trunc('month', "spentAt") AS month,
            SUM("amount") AS amount,
            COUNT(*) AS count
          FROM "Expense"
          WHERE "businessId" = ${businessId}
            AND "status" = 'CONFIRMED'
            AND "spentAt" >= ${from}
            AND "spentAt" < ${endExclusive}
          GROUP BY 1
        ),
        months AS (
          SELECT month FROM sales_by_month
          UNION
          SELECT month FROM sales_returns_by_month
          UNION
          SELECT month FROM cogs_by_month
          UNION
          SELECT month FROM purchases_by_month
          UNION
          SELECT month FROM receipts_by_month
          UNION
          SELECT month FROM payments_by_month
          UNION
          SELECT month FROM expenses_by_month
        )
        SELECT
          to_char(months.month, 'YYYY-MM') AS month,
          COALESCE(sales_by_month.sales, 0)::text AS sales,
          COALESCE(sales_by_month."salesCount", 0)::text AS "salesCount",
          COALESCE(sales_by_month."salesReturnCount", 0)::text AS "salesReturnCount",
          COALESCE(sales_by_month."costedSales", 0)::text AS "costedSales",
          COALESCE(sales_by_month."costedSalesCount", 0)::text AS "costedSalesCount",
          COALESCE(sales_by_month."uncostedSales", 0)::text AS "uncostedSales",
          COALESCE(sales_by_month."uncostedSalesCount", 0)::text AS "uncostedSalesCount",
          COALESCE(sales_by_month."partiallyCostedSalesCount", 0)::text AS "partiallyCostedSalesCount",
          COALESCE(cogs_by_month.cost, 0)::text AS "recognizedCostOfGoodsSold",
          COALESCE(purchases_by_month.amount, 0)::text AS purchases,
          COALESCE(purchases_by_month.count, 0)::text AS "purchaseCount",
          COALESCE(purchases_by_month."returnCount", 0)::text AS "purchaseReturnCount",
          COALESCE(receipts_by_month.amount, 0)::text AS receipts,
          COALESCE(receipts_by_month.count, 0)::text AS "receiptCount",
          COALESCE(payments_by_month.amount, 0)::text AS payments,
          COALESCE(payments_by_month.count, 0)::text AS "paymentCount",
          COALESCE(expenses_by_month.amount, 0)::text AS expenses,
          COALESCE(expenses_by_month.count, 0)::text AS "expenseCount"
        FROM months
        LEFT JOIN sales_by_month USING (month)
        LEFT JOIN cogs_by_month USING (month)
        LEFT JOIN purchases_by_month USING (month)
        LEFT JOIN receipts_by_month USING (month)
        LEFT JOIN payments_by_month USING (month)
        LEFT JOIN expenses_by_month USING (month)
        ORDER BY months.month ASC
      `,
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

    const total = (field: keyof (typeof monthlyRows)[number]) =>
      monthlyRows.reduce((sum, row) => sum + BigInt(row[field]), 0n);
    const sales = {
      amount: total("sales"),
      count: Number(total("salesCount")),
    };
    const purchases = {
      amount: total("purchases"),
      count: Number(total("purchaseCount")),
    };
    const purchaseReturnsCount = Number(total("purchaseReturnCount"));
    const receipts = {
      amount: total("receipts"),
      count: Number(total("receiptCount")),
    };
    const payments = {
      amount: total("payments"),
      count: Number(total("paymentCount")),
    };
    const expenses = {
      amount: total("expenses"),
      count: Number(total("expenseCount")),
    };

    const costedSalesAmount = total("costedSales");
    const costOfGoodsSold = total("recognizedCostOfGoodsSold");
    const uncostedSales = total("uncostedSales");
    const costedSalesCount = Number(total("costedSalesCount"));
    const uncostedSalesCount = Number(total("uncostedSalesCount"));
    const partiallyCostedSalesCount = Number(total("partiallyCostedSalesCount"));
    const grossProfit = costedSalesAmount - costOfGoodsSold;
    const monthlyPerformance = monthlyRows.map((row) => {
      const monthCostedSales = BigInt(row.costedSales);
      const monthCostOfGoodsSold = BigInt(row.recognizedCostOfGoodsSold);

      return {
        month: row.month,
        sales: serializeAmount(BigInt(row.sales)),
        purchases: serializeAmount(BigInt(row.purchases)),
        receipts: serializeAmount(BigInt(row.receipts)),
        payments: serializeAmount(BigInt(row.payments)),
        expenses: serializeAmount(BigInt(row.expenses)),
        costOfGoodsSold: serializeAmount(monthCostOfGoodsSold),
        grossProfit: serializeAmount(monthCostedSales - monthCostOfGoodsSold),
        uncostedSales: serializeAmount(BigInt(row.uncostedSales)),
      };
    });

    return NextResponse.json({
      currencyUnit: business.currencyUnit,

      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },

      summary: {
        sales: {
          amount: serializeAmount(sales.amount),
          count: sales.count,
        },

        purchases: {
          amount: serializeAmount(purchases.amount),
          count: purchases.count,
        },
        purchaseReturns: {
          count: purchaseReturnsCount,
        },

        receipts: {
          amount: serializeAmount(receipts.amount),
          count: receipts.count,
        },

        payments: {
          amount: serializeAmount(payments.amount),
          count: payments.count,
        },

        expenses: {
          amount: serializeAmount(expenses.amount),
          count: expenses.count,
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
        partiallyCostedSales: {
          count: partiallyCostedSalesCount,
        },
      },

      costing: {
        hasUncostedSales: uncostedSalesCount > 0,
      },

      monthlyPerformance,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("REPORTS_API_ERROR:", error);

    return NextResponse.json(
      { error: "دریافت گزارش‌های مالی ناموفق بود." },
      { status: 500 }
    );
  }
}