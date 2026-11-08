import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ contactId: string }>;
};

type InvoiceCursor = {
  date: Date;
  id: string;
};

type PaymentMethodSummary = {
  method: string;
  amount: string;
  paidAmount: string;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 401 });
    }

    const { contactId } = await context.params;
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    const rawCursor = searchParams.get("cursor");
    const settlement = searchParams.get("settlement") ?? "all";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const isValidDate = (value: string | null) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (rawCursor !== null && rawCursor.length > 200) ||
      !["all", "settled", "outstanding"].includes(settlement) ||
      !isValidDate(startDate) ||
      !isValidDate(endDate) ||
      (startDate && endDate && startDate > endDate)
    ) {
      return NextResponse.json({ error: "فیلتر یا محدوده صفحه‌بندی فاکتورها معتبر نیست." }, { status: 400 });
    }

    let cursor: InvoiceCursor | null = null;
    if (rawCursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(rawCursor, "base64url").toString("utf8"),
        ) as { date?: unknown; id?: unknown };
        const date = typeof decoded.date === "string" ? new Date(decoded.date) : null;
        if (
          !date ||
          Number.isNaN(date.getTime()) ||
          typeof decoded.id !== "string" ||
          decoded.id.length === 0
        ) {
          throw new Error("INVALID_INVOICE_CURSOR");
        }
        cursor = { date, id: decoded.id };
      } catch {
        return NextResponse.json({ error: "نشانگر صفحه‌بندی فاکتورها معتبر نیست." }, { status: 400 });
      }
    }

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, businessId: user.business.id },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: "طرف حساب پیدا نشد." }, { status: 404 });
    }

    const dateConditions: Prisma.Sql[] = [];
    if (startDate) {
      dateConditions.push(Prisma.sql`i."invoiceDate" >= ${new Date(`${startDate}T00:00:00.000Z`)}`);
    }
    if (endDate) {
      dateConditions.push(Prisma.sql`i."invoiceDate" < ${new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86400000)}`);
    }
    const dateFilter = dateConditions.length ? Prisma.join(dateConditions, " AND ") : Prisma.sql`TRUE`;
    const cursorFilter = cursor
      ? Prisma.sql`(i."invoiceDate" < ${cursor.date} OR (i."invoiceDate" = ${cursor.date} AND i."id" < ${cursor.id}))`
      : Prisma.sql`TRUE`;
    const settlementFilter =
      settlement === "settled"
        ? Prisma.sql`"balanceDue" <= 0`
        : settlement === "outstanding"
          ? Prisma.sql`"balanceDue" > 0`
          : Prisma.sql`TRUE`;

    const rows = await prisma.$queryRaw<{
      id: string;
      invoiceNumber: string;
      type: string;
      invoiceDate: Date;
      total: bigint;
      paidAmount: bigint;
      balanceDue: bigint;
      paymentMethods: PaymentMethodSummary[];
    }[]>`
      WITH method_totals AS (
        SELECT
          p."invoiceId",
          p."method",
          SUM(p."amount") AS amount,
          COALESCE(SUM(p."amount") FILTER (
            WHERE p."method" <> 'LEDGER'
              AND (p."method" <> 'CHECK' OR p."checkClearedAt" IS NOT NULL)
          ), 0) AS "paidAmount"
        FROM "Payment" p
        WHERE p."businessId" = ${user.business.id}
          AND p."status" = 'CONFIRMED'
          AND p."invoiceId" IS NOT NULL
        GROUP BY p."invoiceId", p."method"
      ),
      payment_totals AS (
        SELECT
          "invoiceId",
          SUM("paidAmount") AS "paidAmount",
          jsonb_agg(jsonb_build_object(
            'method', "method"::text,
            'amount', amount::text,
            'paidAmount', "paidAmount"::text
          ) ORDER BY "method") AS "paymentMethods"
        FROM method_totals
        GROUP BY "invoiceId"
      ),
      return_totals AS (
        SELECT returns."invoiceId", SUM(returns."total") AS amount
        FROM (
          SELECT "invoiceId", "total"
          FROM "SalesReturn"
          WHERE "businessId" = ${user.business.id}
          UNION ALL
          SELECT "invoiceId", "total"
          FROM "PurchaseReturn"
          WHERE "businessId" = ${user.business.id}
        ) returns
        GROUP BY returns."invoiceId"
      ),
      invoice_balances AS (
        SELECT
          i."id",
          i."invoiceNumber",
          i."type"::text AS type,
          i."invoiceDate",
          i."total",
          COALESCE(pt."paidAmount", 0) AS "paidAmount",
          i."total" - COALESCE(pt."paidAmount", 0)
            - COALESCE(rt.amount, 0) AS "balanceDue",
          COALESCE(pt."paymentMethods", '[]'::jsonb) AS "paymentMethods"
        FROM "Invoice" i
        LEFT JOIN payment_totals pt ON pt."invoiceId" = i."id"
        LEFT JOIN return_totals rt ON rt."invoiceId" = i."id"
        WHERE i."businessId" = ${user.business.id}
          AND i."contactId" = ${contactId}
          AND i."status" = 'ISSUED'
          AND (${dateFilter})
      )
      SELECT *
      FROM invoice_balances i
      WHERE (${settlementFilter})
        AND (${cursorFilter})
      ORDER BY i."invoiceDate" DESC, i."id" DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const invoices = hasMore ? rows.slice(0, limit) : rows;
    const lastInvoice = invoices.at(-1);
    const nextCursor = hasMore && lastInvoice
      ? Buffer.from(JSON.stringify({
          date: lastInvoice.invoiceDate.toISOString(),
          id: lastInvoice.id,
        })).toString("base64url")
      : null;

    return NextResponse.json({
      invoices: invoices.map((invoice) => ({
        ...invoice,
        invoiceDate: invoice.invoiceDate.toISOString(),
        total: invoice.total.toString(),
        paidAmount: invoice.paidAmount.toString(),
        balanceDue: invoice.balanceDue.toString(),
      })),
      nextCursor,
    });
  } catch (error) {
    console.error("GET /api/contacts/[contactId]/invoices error:", error);
    return NextResponse.json({ error: "خطا در دریافت فاکتورهای طرف حساب." }, { status: 500 });
  }
}
