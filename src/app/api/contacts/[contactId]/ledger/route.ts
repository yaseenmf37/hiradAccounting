
import { NextResponse } from "next/server";
import {
  Prisma,
  PaymentStatus,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ contactId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const { contactId } = await context.params;
    const { searchParams } = new URL(_request.url);

const rawStartDate = searchParams.get("startDate");
const rawEndDate = searchParams.get("endDate");

const startDate = rawStartDate?.trim() || null;
const endDate = rawEndDate?.trim() || null;
const rawLimit = searchParams.get("limit");
const limit = rawLimit === null ? 50 : Number(rawLimit);
const rawCursor = searchParams.get("cursor");

if (
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 100 ||
  (rawCursor !== null && rawCursor.length > 200)
) {
  return NextResponse.json(
    { error: "محدوده صفحه‌بندی معتبر نیست." },
    { status: 400 },
  );
}

const isValidDate = (value: string | null) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

if (
  !isValidDate(startDate) ||
  !isValidDate(endDate) ||
  (startDate && endDate && startDate > endDate)
) {
  return NextResponse.json(
    { error: "بازه تاریخی واردشده معتبر نیست." },
    { status: 400 },
  );
}

    const businessId = user.business.id;
    let cursor: { date: Date; id: string } | null = null;
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
          throw new Error("INVALID_LEDGER_CURSOR");
        }
        cursor = { date, id: decoded.id };
      } catch {
        return NextResponse.json(
          { error: "نشانگر صفحه‌بندی دفتر حساب معتبر نیست." },
          { status: 400 },
        );
      }
    }

    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        businessId,
      },
      select: {
        id: true,
        name: true,
        type: true,
        phone: true,
        isActive: true,
      },
    });

    if (!contact) {
      return NextResponse.json(
        { error: "طرف حساب پیدا نشد." },
        { status: 404 },
      );
    }

    const rangeConditions: Prisma.Sql[] = [];
    if (startDate) {
      rangeConditions.push(
        Prisma.sql`("date" AT TIME ZONE 'Asia/Tehran')::date >= ${startDate}::date`,
      );
    }
    if (endDate) {
      rangeConditions.push(
        Prisma.sql`("date" AT TIME ZONE 'Asia/Tehran')::date <= ${endDate}::date`,
      );
    }
    const rangeFilter =
      rangeConditions.length > 0
        ? Prisma.join(rangeConditions, " AND ")
        : Prisma.sql`TRUE`;

    const cursorAfter = cursor
      ? Prisma.sql`("date" > ${cursor.date} OR ("date" = ${cursor.date} AND "id" > ${cursor.id}))`
      : Prisma.sql`TRUE`;
    const cursorThrough = cursor
      ? Prisma.sql`("date" < ${cursor.date} OR ("date" = ${cursor.date} AND "id" <= ${cursor.id}))`
      : Prisma.sql`FALSE`;
    const openingConditions: Prisma.Sql[] = [];
    if (startDate) {
      openingConditions.push(
        Prisma.sql`("date" AT TIME ZONE 'Asia/Tehran')::date < ${startDate}::date`,
      );
    }
    if (cursor) {
      openingConditions.push(
        Prisma.sql`((${rangeFilter}) AND (${cursorThrough}))`,
      );
    }
    const openingFilter =
      openingConditions.length > 0
        ? Prisma.join(openingConditions, " OR ")
        : Prisma.sql`FALSE`;

    const ledgerEntries = Prisma.sql`
      SELECT
        i."id",
        'INVOICE'::text AS "kind",
        i."invoiceDate" AS "date",
        CASE WHEN i."type" = 'SALE' THEN 'فاکتور فروش' ELSE 'فاکتور خرید' END AS "title",
        i."invoiceNumber" AS "reference",
        CASE WHEN i."type" = 'SALE' THEN 'DEBIT' ELSE 'CREDIT' END AS "direction",
        i."total" AS "amount",
        CASE WHEN i."contactNameSnapshot" IS NOT NULL THEN
          CONCAT(
            'طرف حساب: ', i."contactNameSnapshot",
            CASE WHEN i."contactPhoneSnapshot" IS NOT NULL THEN CONCAT('، تماس: ', i."contactPhoneSnapshot") ELSE '' END,
            CASE WHEN i."contactAddressSnapshot" IS NOT NULL THEN CONCAT('، آدرس: ', i."contactAddressSnapshot") ELSE '' END
          )
        ELSE NULL END AS "description",
        NULL::text AS "paymentMethod",
        NULL::text AS "trackingNumber",
        NULL::text AS "invoiceId",
        NULL::text AS "checkNumber",
        NULL::timestamptz AS "checkIssuedAt",
        NULL::timestamptz AS "checkDueAt",
        NULL::text AS "payableTo",
        NULL::text AS "destinationDetails",
        CASE WHEN i."type" = 'SALE' THEN i."total" ELSE -i."total" END AS "signedAmount"
      FROM "Invoice" i
      WHERE i."businessId" = ${businessId}
        AND i."contactId" = ${contactId}
        AND i."status" = 'ISSUED'

      UNION ALL

      SELECT
        r."id",
        'PURCHASE_RETURN'::text AS "kind",
        r."createdAt" AS "date",
        'مرجوعی خرید'::text AS "title",
        r."returnNumber" AS "reference",
        'DEBIT'::text AS "direction",
        r."total" AS "amount",
        r."description" AS "description",
        NULL::text AS "paymentMethod",
        NULL::text AS "trackingNumber",
        r."invoiceId" AS "invoiceId",
        NULL::text AS "checkNumber",
        NULL::timestamptz AS "checkIssuedAt",
        NULL::timestamptz AS "checkDueAt",
        NULL::text AS "payableTo",
        NULL::text AS "destinationDetails",
        r."total" AS "signedAmount"
      FROM "PurchaseReturn" r
      JOIN "Invoice" i ON i."id" = r."invoiceId"
      WHERE r."businessId" = ${businessId}
        AND i."contactId" = ${contactId}

      UNION ALL

      SELECT
        r."id",
        'SALES_RETURN'::text AS "kind",
        r."createdAt" AS "date",
        'مرجوعی فروش'::text AS "title",
        r."returnNumber" AS "reference",
        'CREDIT'::text AS "direction",
        r."total" AS "amount",
        r."description" AS "description",
        NULL::text AS "paymentMethod",
        NULL::text AS "trackingNumber",
        r."invoiceId" AS "invoiceId",
        NULL::text AS "checkNumber",
        NULL::timestamptz AS "checkIssuedAt",
        NULL::timestamptz AS "checkDueAt",
        NULL::text AS "payableTo",
        NULL::text AS "destinationDetails",
        -r."total" AS "signedAmount"
      FROM "SalesReturn" r
      JOIN "Invoice" i ON i."id" = r."invoiceId"
      WHERE r."businessId" = ${businessId}
        AND i."businessId" = ${businessId}
        AND i."contactId" = ${contactId}

      UNION ALL

      SELECT
        p."id",
        'PAYMENT'::text AS "kind",
        p."paidAt" AS "date",
        CASE
          WHEN p."method" = 'LEDGER' THEN 'ثبت در حساب دفتری'
          WHEN p."type" = 'RECEIPT' THEN 'دریافت وجه'
          ELSE 'پرداخت وجه'
        END AS "title",
        COALESCE(pr."returnNumber", sr."returnNumber", i."invoiceNumber") AS "reference",
        CASE
          WHEN p."method" = 'LEDGER' THEN 'INFO'
          WHEN p."type" = 'RECEIPT' THEN 'CREDIT'
          ELSE 'DEBIT'
        END AS "direction",
        p."amount" AS "amount",
        p."description" AS "description",
        p."method"::text AS "paymentMethod",
        p."trackingNumber" AS "trackingNumber",
        COALESCE(p."invoiceId", pr."invoiceId", sr."invoiceId") AS "invoiceId",
        p."checkNumber" AS "checkNumber",
        p."checkIssuedAt" AS "checkIssuedAt",
        p."checkDueAt" AS "checkDueAt",
        p."payableTo" AS "payableTo",
        p."destinationDetails" AS "destinationDetails",
        CASE
          WHEN p."method" = 'LEDGER' THEN 0
          WHEN p."type" = 'RECEIPT' THEN -p."amount"
          ELSE p."amount"
        END AS "signedAmount"
      FROM "Payment" p
      LEFT JOIN "Invoice" i ON i."id" = p."invoiceId"
      LEFT JOIN "PurchaseReturn" pr ON pr."id" = p."purchaseReturnId"
      LEFT JOIN "SalesReturn" sr
        ON sr."id" = p."salesReturnId" AND sr."businessId" = p."businessId"
      WHERE p."businessId" = ${businessId}
        AND p."contactId" = ${contactId}
        AND p."status" = ${PaymentStatus.CONFIRMED}::"PaymentStatus"
    `;

    const summaryQuery = Prisma.sql`
      WITH entries AS (${ledgerEntries}),
      ranged AS (SELECT * FROM entries WHERE (${rangeFilter}))
      SELECT
        COALESCE((SELECT SUM("signedAmount") FROM entries WHERE ${startDate ? Prisma.sql`("date" AT TIME ZONE 'Asia/Tehran')::date < ${startDate}::date` : Prisma.sql`FALSE`}), 0)::text AS "openingBalance",
        COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0)::text AS "totalDebit",
        COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0)::text AS "totalCredit",
        COALESCE(SUM("signedAmount"), 0)::text AS "rangeDelta",
        COUNT(*)::integer AS "transactionCount"
      FROM ranged
    `;

    const pageQuery = Prisma.sql`
      WITH entries AS (${ledgerEntries}),
      opening AS (
        SELECT COALESCE(SUM("signedAmount"), 0) AS "amount"
        FROM entries
        WHERE (${openingFilter})
      ),
      page_entries AS (
        SELECT *
        FROM entries
        WHERE (${rangeFilter}) AND (${cursorAfter})
        ORDER BY "date" ASC, "id" ASC
        LIMIT ${limit + 1}
      )
      SELECT page_entries.*, opening."amount"::text AS "pageOpeningBalance"
      FROM page_entries CROSS JOIN opening
      ORDER BY page_entries."date" ASC, page_entries."id" ASC
    `;

    type LedgerRow = {
      id: string;
      kind: "INVOICE" | "PURCHASE_RETURN" | "SALES_RETURN" | "PAYMENT";
      date: Date;
      title: string;
      reference: string | null;
      direction: "DEBIT" | "CREDIT" | "INFO";
      amount: bigint;
      description: string | null;
      paymentMethod: string | null;
      trackingNumber: string | null;
      invoiceId: string | null;
      checkNumber: string | null;
      checkIssuedAt: Date | null;
      checkDueAt: Date | null;
      payableTo: string | null;
      destinationDetails: string | null;
      signedAmount: bigint;
      pageOpeningBalance: string;
    };
    type LedgerSummary = {
      openingBalance: string;
      totalDebit: string;
      totalCredit: string;
      rangeDelta: string;
      transactionCount: number;
    };

    const [summaryRows, pageRows] = await prisma.$transaction([
      prisma.$queryRaw<LedgerSummary[]>(summaryQuery),
      prisma.$queryRaw<LedgerRow[]>(pageQuery),
    ]);

    const summary = summaryRows[0];
    if (!summary) throw new Error("LEDGER_SUMMARY_MISSING");
    const hasMore = pageRows.length > limit;
    const page = hasMore ? pageRows.slice(0, limit) : pageRows;
    let runningBalance = BigInt(page[0]?.pageOpeningBalance ?? summary.openingBalance);
    const entriesWithBalance = page.map((entry) => {
      runningBalance += entry.signedAmount;
      return {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        reference: entry.reference,
        direction: entry.direction,
        amount: entry.amount.toString(),
        date: entry.date.toISOString(),
        description: entry.description,
        ...(entry.paymentMethod
          ? {
              paymentMethod: entry.paymentMethod,
              trackingNumber: entry.trackingNumber,
              paymentDetails: {
                checkNumber: entry.checkNumber,
                checkIssuedAt: entry.checkIssuedAt?.toISOString() ?? null,
                checkDueAt: entry.checkDueAt?.toISOString() ?? null,
                payableTo: entry.payableTo,
                destinationDetails: entry.destinationDetails,
              },
            }
          : {}),
        ...(entry.invoiceId ? { invoiceId: entry.invoiceId } : {}),
        balance: runningBalance.toString(),
      };
    });
    const openingBalance = BigInt(summary.openingBalance);
    const balance = openingBalance + BigInt(summary.rangeDelta);
    const lastEntry = page.at(-1);
    const nextCursor =
      hasMore && lastEntry
        ? Buffer.from(
            JSON.stringify({ date: lastEntry.date.toISOString(), id: lastEntry.id }),
          ).toString("base64url")
        : null;

    return NextResponse.json({
      contact,
      summary: {
        openingBalance: summary.openingBalance,
        totalDebit: summary.totalDebit,
        totalCredit: summary.totalCredit,
        balance: balance.toString(),
        balanceStatus:
          balance > BigInt(0)
            ? "CONTACT_OWES_BUSINESS"
            : balance < BigInt(0)
              ? "BUSINESS_OWES_CONTACT"
              : "SETTLED",
        transactionCount: summary.transactionCount,
      },
      entries: entriesWithBalance,
      total: summary.transactionCount,
      nextCursor,
    });
  } catch (error) {
    console.error("GET /api/contacts/[contactId]/ledger error:", error);

    return NextResponse.json(
      { error: "خطا در دریافت دفتر حساب طرف حساب." },
      { status: 500 },
    );
  }
}
