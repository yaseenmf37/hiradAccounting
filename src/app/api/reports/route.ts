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

    const [monthlyRows, productRows, business] = await Promise.all([
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
        cashReceipts: string;
        posReceipts: string;
        passedChecks: string;
        unpassedChecks: string;
        passedPaymentChecks: string;
        unpassedPaymentChecks: string;
        ledgerReceipts: string;
        ledgerPayments: string;
        otherReceipts: string;
        otherPayments: string;
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
            i."subtotal",
            i."discount",
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
          GROUP BY
            i."id",
            i."invoiceDate",
            i."total",
            i."subtotal",
            i."discount",
            i."costingRecordedAt"
        ),
        sales_returns_by_month AS (
          SELECT
            date_trunc('month', r."createdAt") AS month,
            SUM(COALESCE(
              ROUND(
                r."total"::numeric
                * (i."subtotal" - i."discount")
                / NULLIF(i."total", 0)
              ),
              0
            )) AS amount,
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
            SUM("subtotal" - "discount") AS sales,
            COUNT(*) AS "salesCount",
            SUM(
          CASE WHEN "totalBasis" > 0
            THEN ROUND(("subtotal" - "discount")::numeric * "costedBasis" / "totalBasis")
            ELSE 0
          END
        ) AS "costedSales",

        COUNT(*) FILTER (
          WHERE "costingRecordedAt" IS NOT NULL
        ) AS "costedSalesCount",

        SUM(
          ("subtotal" - "discount") -
          CASE WHEN "totalBasis" > 0
            THEN ROUND(("subtotal" - "discount")::numeric * "costedBasis" / "totalBasis")
            ELSE 0
          END
        ) AS "uncostedSales",
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
        payments_by_month AS (
          SELECT
            date_trunc('month', CASE
              WHEN p."method" = 'CHECK' AND p."checkClearedAt" IS NOT NULL THEN p."checkClearedAt"
              WHEN p."method" = 'CHECK' THEN p."paidAt"
              WHEN p."method" = 'LEDGER' THEN COALESCE(i."invoiceDate", p."paidAt")
              ELSE p."paidAt"
            END) AS month,
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" <> 'LEDGER'
              AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)
              THEN p."amount" ELSE 0 END) AS receipts,
            COUNT(*) FILTER (WHERE p."type" = 'RECEIPT' AND p."method" <> 'LEDGER'
              AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)) AS "receiptCount",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" = 'CASH' THEN p."amount" ELSE 0 END) AS "cashReceipts",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" = 'POS' THEN p."amount" ELSE 0 END) AS "posReceipts",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" = 'CHECK'
              AND p."checkClearedAt" IS NOT NULL THEN p."amount" ELSE 0 END) AS "passedChecks",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" = 'CHECK'
              AND p."checkClearedAt" IS NULL THEN p."amount" ELSE 0 END) AS "unpassedChecks",
            SUM(CASE WHEN p."type" = 'PAYMENT' AND p."method" = 'CHECK'
              AND p."checkClearedAt" IS NOT NULL THEN p."amount" ELSE 0 END) AS "passedPaymentChecks",
            SUM(CASE WHEN p."type" = 'PAYMENT' AND p."method" = 'CHECK'
              AND p."checkClearedAt" IS NULL THEN p."amount" ELSE 0 END) AS "unpassedPaymentChecks",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" = 'LEDGER'
              THEN p."amount" ELSE 0 END) AS "ledgerReceipts",
            SUM(CASE WHEN p."type" = 'PAYMENT' AND p."method" = 'LEDGER'
              THEN p."amount" ELSE 0 END) AS "ledgerPayments",
            SUM(CASE WHEN p."type" = 'RECEIPT' AND p."method" IN ('CARD_TO_CARD', 'BANK_TRANSFER')
              THEN p."amount" ELSE 0 END) AS "otherReceipts",
            SUM(CASE WHEN p."type" = 'PAYMENT' AND p."method" NOT IN ('CHECK', 'LEDGER')
              THEN p."amount" ELSE 0 END) AS "otherPayments",
            SUM(CASE WHEN p."type" = 'PAYMENT' AND p."method" <> 'LEDGER'
              AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)
              THEN p."amount" ELSE 0 END) AS payments,
            COUNT(*) FILTER (WHERE p."type" = 'PAYMENT' AND p."method" <> 'LEDGER'
              AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)) AS "paymentCount"
          FROM "Payment" p
          LEFT JOIN "Invoice" i ON i."id" = p."invoiceId" AND i."businessId" = p."businessId"
          WHERE p."businessId" = ${businessId}
            AND p."status" = 'CONFIRMED'
            AND (
              (p."method" = 'CHECK' AND COALESCE(p."checkClearedAt", p."paidAt") >= ${from}
                AND COALESCE(p."checkClearedAt", p."paidAt") < ${endExclusive})
              OR (p."method" = 'LEDGER' AND COALESCE(i."invoiceDate", p."paidAt") >= ${from}
                AND COALESCE(i."invoiceDate", p."paidAt") < ${endExclusive})
              OR (p."method" NOT IN ('CHECK', 'LEDGER') AND p."paidAt" >= ${from}
                AND p."paidAt" < ${endExclusive})
            )
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
        invoice_extra_costs_by_month AS (
          SELECT
            date_trunc('month', "invoiceDate") AS month,
            SUM("extraCosts") AS amount,
            COUNT(*) AS count
          FROM "Invoice"
          WHERE "businessId" = ${businessId}
            AND "status" = 'ISSUED'
            AND "extraCosts" > 0
            AND "invoiceDate" >= ${from}
            AND "invoiceDate" < ${endExclusive}
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
          SELECT month FROM payments_by_month
          UNION
          SELECT month FROM expenses_by_month
          UNION
          SELECT month FROM invoice_extra_costs_by_month
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
          COALESCE(payments_by_month.receipts, 0)::text AS receipts,
          COALESCE(payments_by_month."receiptCount", 0)::text AS "receiptCount",
          COALESCE(payments_by_month."cashReceipts", 0)::text AS "cashReceipts",
          COALESCE(payments_by_month."posReceipts", 0)::text AS "posReceipts",
          COALESCE(payments_by_month."passedChecks", 0)::text AS "passedChecks",
          COALESCE(payments_by_month."unpassedChecks", 0)::text AS "unpassedChecks",
          COALESCE(payments_by_month."passedPaymentChecks", 0)::text AS "passedPaymentChecks",
          COALESCE(payments_by_month."unpassedPaymentChecks", 0)::text AS "unpassedPaymentChecks",
          COALESCE(payments_by_month."ledgerReceipts", 0)::text AS "ledgerReceipts",
          COALESCE(payments_by_month."ledgerPayments", 0)::text AS "ledgerPayments",
          COALESCE(payments_by_month."otherReceipts", 0)::text AS "otherReceipts",
          COALESCE(payments_by_month."otherPayments", 0)::text AS "otherPayments",
          COALESCE(payments_by_month.payments, 0)::text AS payments,
          COALESCE(payments_by_month."paymentCount", 0)::text AS "paymentCount",
          (
            COALESCE(expenses_by_month.amount, 0)
            + COALESCE(invoice_extra_costs_by_month.amount, 0)
          )::text AS expenses,
          (
            COALESCE(expenses_by_month.count, 0)
            + COALESCE(invoice_extra_costs_by_month.count, 0)
          )::text AS "expenseCount"
        FROM months
        LEFT JOIN sales_by_month USING (month)
        LEFT JOIN cogs_by_month USING (month)
        LEFT JOIN purchases_by_month USING (month)
        LEFT JOIN payments_by_month USING (month)
        LEFT JOIN expenses_by_month USING (month)
        LEFT JOIN invoice_extra_costs_by_month USING (month)
        ORDER BY months.month ASC
      `,
      prisma.$queryRaw<{
        month: string;
        productId: string;
        productName: string;
        quantitySold: string;
        sales: string;
        discount: string;
        returns: string;
        costOfGoodsSold: string;
        returnedCost: string;
        uncostedSales: string;
        grossProfit: string | null;
      }[]>`
        WITH invoice_item_values AS (
          SELECT
            date_trunc('month', i."invoiceDate") AS month,
            i."invoiceDate",
            i."id" AS "invoiceId",
            i."discount",
            i."subtotal",
            ii."id" AS "invoiceItemId",
            ii."productId",
            p."name" AS "productName",
            ii."total" AS "itemTotal",
            ii."costOfGoodsSold",
            ii."costedQuantity",
            ii."quantity"
          FROM "InvoiceItem" ii
          JOIN "Invoice" i ON i."id" = ii."invoiceId"
          JOIN "Product" p ON p."id" = ii."productId" AND p."businessId" = ${businessId}
          WHERE i."businessId" = ${businessId}
            AND i."type" = 'SALE'
            AND i."status" = 'ISSUED'
            AND (
              (i."invoiceDate" >= ${from} AND i."invoiceDate" < ${endExclusive})
              OR EXISTS (
                SELECT 1
                FROM "SalesReturnItem" return_item
                JOIN "SalesReturn" return_record
                  ON return_record."id" = return_item."salesReturnId"
                  AND return_record."businessId" = return_item."businessId"
                WHERE return_item."invoiceId" = i."id"
                  AND return_item."businessId" = ${businessId}
                  AND return_record."createdAt" >= ${from}
                  AND return_record."createdAt" < ${endExclusive}
              )
            )
        ),
        item_discount_pools AS (
          SELECT
            "invoiceId",
            "discount" AS "itemDiscount"
          FROM invoice_item_values
          GROUP BY "invoiceId", "discount"
        ),
        item_discount_floors AS (
          SELECT
            item.*,
            ROW_NUMBER() OVER (
              PARTITION BY item."invoiceId"
              ORDER BY item."invoiceItemId"
            ) AS "itemRank",
            pool."itemDiscount",
            CASE
              WHEN SUM(item."itemTotal") OVER (
                PARTITION BY item."invoiceId"
              ) > 0
                THEN FLOOR(
                  pool."itemDiscount"::numeric * item."itemTotal"
                  / SUM(item."itemTotal") OVER (
                    PARTITION BY item."invoiceId"
                  )
                )::bigint
              ELSE 0::bigint
            END AS "discountFloor"
          FROM invoice_item_values item
          JOIN item_discount_pools pool USING ("invoiceId")
        ),
        item_discount_allocations AS (
          SELECT
            *,
            "discountFloor" + CASE
              WHEN "itemRank" <= "itemDiscount" - SUM("discountFloor") OVER (PARTITION BY "invoiceId")
                THEN 1
              ELSE 0
            END AS "allocatedDiscount"
          FROM item_discount_floors
        ),
        sales_by_product AS (
          SELECT
            month,
            "productId",
            "productName",
            SUM("itemTotal" - "allocatedDiscount") AS sales,
            SUM("allocatedDiscount") AS discount,
            SUM("quantity") AS "quantitySold",
            SUM(
              ("itemTotal" - "allocatedDiscount")
              - ROUND(
                ("itemTotal" - "allocatedDiscount")::numeric
                * LEAST("costedQuantity", "quantity") / NULLIF("quantity", 0)
              )
            ) AS "uncostedSales",
            SUM(ROUND(
              ("itemTotal" - "allocatedDiscount")::numeric
              * LEAST("costedQuantity", "quantity") / NULLIF("quantity", 0)
            )) AS "costedSales",
            SUM("costOfGoodsSold") AS "costOfGoodsSold"
          FROM item_discount_allocations
          WHERE "invoiceDate" >= ${from}
            AND "invoiceDate" < ${endExclusive}
          GROUP BY month, "productId", "productName"
        ),
        returns_by_product AS (
          SELECT
            date_trunc('month', r."createdAt") AS month,
            ri."productId",
            p."name" AS "productName",
            SUM(ri."quantity") AS quantity,
            SUM(COALESCE(
              ROUND(
                ri."amount"::numeric
                * (i."subtotal" - i."discount")
                / NULLIF(i."total", 0)
              ),
              0
            )) AS amount,
            SUM(COALESCE(
              ROUND(
                alloc."allocatedDiscount"::numeric * ri."quantity"
                / NULLIF(alloc."quantity", 0)
              ),
              0
            )) AS discount,
            SUM(COALESCE(
              ROUND(
                (alloc."itemTotal" - alloc."allocatedDiscount")::numeric
                * ri."quantity"
                * GREATEST(
                  alloc."quantity" - LEAST(alloc."costedQuantity", alloc."quantity"),
                  0
                )
                / NULLIF(alloc."quantity" * alloc."quantity", 0)
              ),
              0
            )) AS "uncostedSales",
            SUM(ri."inventoryCost") AS cost
          FROM "SalesReturnItem" ri
          JOIN "SalesReturn" r ON r."id" = ri."salesReturnId" AND r."businessId" = ri."businessId"
          JOIN "Invoice" i ON i."id" = r."invoiceId" AND i."businessId" = r."businessId"
          JOIN item_discount_allocations alloc
            ON alloc."invoiceItemId" = ri."invoiceItemId"
            AND alloc."invoiceId" = ri."invoiceId"
          JOIN "Product" p ON p."id" = ri."productId" AND p."businessId" = ${businessId}
          WHERE ri."businessId" = ${businessId}
            AND i."type" = 'SALE'
            AND r."createdAt" >= ${from}
            AND r."createdAt" < ${endExclusive}
          GROUP BY 1, ri."productId", p."name"
        )
        SELECT
          to_char(COALESCE(s.month, r.month), 'YYYY-MM') AS month,
          COALESCE(s."productId", r."productId") AS "productId",
          COALESCE(s."productName", r."productName") AS "productName",
          (COALESCE(s."quantitySold", 0) - COALESCE(r.quantity, 0))::text AS "quantitySold",
          (COALESCE(s.sales, 0) - COALESCE(r.amount, 0))::text AS sales,
          (COALESCE(s.discount, 0) - COALESCE(r.discount, 0))::text AS discount,
          COALESCE(r.amount, 0)::text AS returns,
          (COALESCE(s."costOfGoodsSold", 0) - COALESCE(r.cost, 0))::text AS "costOfGoodsSold",
          COALESCE(r.cost, 0)::text AS "returnedCost",
          (COALESCE(s."uncostedSales", 0) + COALESCE(r."uncostedSales", 0))::text AS "uncostedSales",
          CASE
            WHEN COALESCE(s."uncostedSales", 0) + COALESCE(r."uncostedSales", 0) > 0 THEN NULL
            ELSE (
              COALESCE(s."costedSales", 0) - COALESCE(r.amount, 0)
              - COALESCE(s."costOfGoodsSold", 0) + COALESCE(r.cost, 0)
            )::text
          END AS "grossProfit"
        FROM sales_by_product s
        FULL OUTER JOIN returns_by_product r
          ON r.month = s.month AND r."productId" = s."productId"
        ORDER BY month DESC, "productName" ASC
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
    const receiptBreakdown = {
      cash: total("cashReceipts"),
      pos: total("posReceipts"),
      passedChecks: total("passedChecks"),
      unpassedChecks: total("unpassedChecks"),
      ledger: total("ledgerReceipts"),
      other: total("otherReceipts"),
    };
    const paymentCheckBreakdown = {
      passed: total("passedPaymentChecks"),
      unpassed: total("unpassedPaymentChecks"),
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
    const knownProductProfitByMonth = new Map<string, bigint>();
    for (const row of productRows) {
      if (row.grossProfit === null) continue;
      knownProductProfitByMonth.set(
        row.month,
        (knownProductProfitByMonth.get(row.month) ?? 0n) + BigInt(row.grossProfit)
      );
    }
    const grossProfit = [...knownProductProfitByMonth.values()]
      .reduce((sum, monthProfit) => sum + monthProfit, 0n);

    const monthlyPerformance = monthlyRows.map((row) => {
      const monthCostOfGoodsSold = BigInt(row.recognizedCostOfGoodsSold);
      const monthGrossProfit = knownProductProfitByMonth.get(row.month) ?? 0n;

      return {
        month: row.month,
        sales: serializeAmount(BigInt(row.sales)),
        purchases: serializeAmount(BigInt(row.purchases)),
        salesPurchaseDifference: serializeAmount(BigInt(row.sales) - BigInt(row.purchases)),
        receipts: serializeAmount(BigInt(row.receipts)),
        cashReceipts: serializeAmount(BigInt(row.cashReceipts)),
        posReceipts: serializeAmount(BigInt(row.posReceipts)),
        passedChecks: serializeAmount(BigInt(row.passedChecks)),
        unpassedChecks: serializeAmount(BigInt(row.unpassedChecks)),
        passedPaymentChecks: serializeAmount(BigInt(row.passedPaymentChecks)),
        unpassedPaymentChecks: serializeAmount(BigInt(row.unpassedPaymentChecks)),
        ledgerReceipts: serializeAmount(BigInt(row.ledgerReceipts)),
        ledgerPayments: serializeAmount(BigInt(row.ledgerPayments)),
        otherReceipts: serializeAmount(BigInt(row.otherReceipts)),
        otherPayments: serializeAmount(BigInt(row.otherPayments)),
        expenses: serializeAmount(BigInt(row.expenses)),
        costOfGoodsSold: serializeAmount(monthCostOfGoodsSold),
        grossProfit: serializeAmount(monthGrossProfit),
        netProfit: serializeAmount(monthGrossProfit - BigInt(row.expenses)),
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
        receiptBreakdown: {
          cash: serializeAmount(receiptBreakdown.cash),
          pos: serializeAmount(receiptBreakdown.pos),
          passedChecks: serializeAmount(receiptBreakdown.passedChecks),
          unpassedChecks: serializeAmount(receiptBreakdown.unpassedChecks),
          ledger: serializeAmount(receiptBreakdown.ledger),
          other: serializeAmount(receiptBreakdown.other),
        },
        paymentCheckBreakdown: {
          passed: serializeAmount(paymentCheckBreakdown.passed),
          unpassed: serializeAmount(paymentCheckBreakdown.unpassed),
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
        netProfit: {
          amount: serializeAmount(grossProfit - expenses.amount),
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

      productPerformance: productRows.map((row) => {
        const sales = BigInt(row.sales);

        return {
          month: row.month,
          productId: row.productId,
          productName: row.productName,
          quantitySold: row.quantitySold,
          sales: serializeAmount(sales),
          discount: row.discount,
          returns: row.returns,
          costOfGoodsSold: row.costOfGoodsSold,
          grossProfit: row.grossProfit,
          uncostedSales: row.uncostedSales,
        };
      }),
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