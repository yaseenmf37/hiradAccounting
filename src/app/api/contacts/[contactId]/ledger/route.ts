
import { NextResponse } from "next/server";
import {
  InvoiceStatus,
  InvoiceType,
  PaymentStatus,
  PaymentType,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ contactId: string }>;
};

function getTehranDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

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

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          businessId,
          contactId,
          status: InvoiceStatus.ISSUED,
        },
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          total: true,
          issuedAt: true,
          createdAt: true,
        },
      }),

      prisma.payment.findMany({
        where: {
          businessId,
          contactId,
          status: PaymentStatus.CONFIRMED,
        },
        select: {
          id: true,
          invoiceId: true,
          type: true,
          method: true,
          amount: true,
          trackingNumber: true,
          description: true,
          paidAt: true,
          createdAt: true,
          invoice: {
            select: {
              invoiceNumber: true,
            },
          },
        },
      }),
    ]);

    type LedgerEntry = {
      id: string;
      kind: "INVOICE" | "PAYMENT";
      title: string;
      reference: string | null;
      direction: "DEBIT" | "CREDIT";
      amount: bigint;
      date: Date;
      description: string | null;
      paymentMethod?: string;
      trackingNumber?: string | null;
      invoiceId?: string;
    };

    const entries: LedgerEntry[] = [];

    for (const invoice of invoices) {
      const isSale = invoice.type === InvoiceType.SALE;

      entries.push({
        id: invoice.id,
        kind: "INVOICE",
        title: isSale ? "فاکتور فروش" : "فاکتور خرید",
        reference: invoice.invoiceNumber,
        direction: isSale ? "DEBIT" : "CREDIT",
        amount: invoice.total,
        date: invoice.issuedAt ?? invoice.createdAt,
        description: null,
      });
    }

    for (const payment of payments) {
      const isReceipt = payment.type === PaymentType.RECEIPT;

      entries.push({
        id: payment.id,
        kind: "PAYMENT",
        title: isReceipt ? "دریافت وجه" : "پرداخت وجه",
        reference: payment.invoice?.invoiceNumber ?? null,
        direction: isReceipt ? "CREDIT" : "DEBIT",
        amount: payment.amount,
        date: payment.paidAt,
        description: payment.description,
        paymentMethod: payment.method,
        trackingNumber: payment.trackingNumber,
        invoiceId: payment.invoiceId ?? undefined,
      });
    }

    entries.sort((a, b) => {
      const dateDifference = a.date.getTime() - b.date.getTime();
      return dateDifference || a.id.localeCompare(b.id);
    });

const openingEntries = entries.filter((entry) => {
  if (!startDate) return false;
  return getTehranDateKey(entry.date) < startDate;
});

const filteredEntries = entries.filter((entry) => {
  const dateKey = getTehranDateKey(entry.date);

  if (startDate && dateKey < startDate) return false;
  if (endDate && dateKey > endDate) return false;

  return true;
});

let openingBalance = BigInt(0);

for (const entry of openingEntries) {
  openingBalance +=
    entry.direction === "DEBIT" ? entry.amount : -entry.amount;
}

let totalDebit = BigInt(0);
let totalCredit = BigInt(0);
let runningBalance = openingBalance;

const entriesWithBalance = filteredEntries.map((entry) => {
  if (entry.direction === "DEBIT") {
    totalDebit += entry.amount;
    runningBalance += entry.amount;
  } else {
    totalCredit += entry.amount;
    runningBalance -= entry.amount;
  }

  return {
    ...entry,
    balance: runningBalance,
  };
});

    const balance = runningBalance;

    return NextResponse.json({
      contact,
      summary: {
      openingBalance: openingBalance.toString(),
        totalDebit: totalDebit.toString(),
        totalCredit: totalCredit.toString(),
        balance: balance.toString(),
        balanceStatus:
          balance > BigInt(0)
            ? "CONTACT_OWES_BUSINESS"
            : balance < BigInt(0)
              ? "BUSINESS_OWES_CONTACT"
              : "SETTLED",
        transactionCount: filteredEntries.length,
      },
      entries: entriesWithBalance.map((entry) => ({
        ...entry,
        amount: entry.amount.toString(),
        balance: entry.balance.toString(),
        date: entry.date.toISOString(),
      })),
    });
  } catch (error) {
    console.error("GET /api/contacts/[contactId]/ledger error:", error);

    return NextResponse.json(
      { error: "خطا در دریافت دفتر حساب طرف حساب." },
      { status: 500 },
    );
  }
}
