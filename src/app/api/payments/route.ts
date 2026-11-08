
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  Prisma,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { toRial } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

const paymentSchema = z.object({
  contactId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  type: z.nativeEnum(PaymentType),
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().int().positive().safe(),
  trackingNumber: z.string().trim().max(100).optional().nullable(),
  checkNumber: z.string().trim().max(100).optional().nullable(),
  checkIssuedAt: z.string().date().optional().nullable(),
  checkDueAt: z.string().date().optional().nullable(),
  checkClearedAt: z.string().date().optional().nullable(),
  payableTo: z.string().trim().max(150).optional().nullable(),
  destinationDetails: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  paidAt: z.string().datetime().optional(),
});

function serializePayment(payment: {
  id: string;
  businessId: string;
  contactId: string | null;
  invoiceId: string | null;
  type: PaymentType;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: bigint;
  trackingNumber: string | null;
  checkNumber?: string | null;
  checkIssuedAt?: Date | null;
  checkDueAt?: Date | null;
  checkClearedAt?: Date | null;
  payableTo?: string | null;
  destinationDetails?: string | null;
  description: string | null;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  contact?: { id: string; name: string } | null;
  invoice?: {
    id: string;
    invoiceNumber: string | null;
    type: string;
    status: string;
    total: bigint;
  } | null;
}) {
  return {
    ...payment,
    amount: payment.amount.toString(),
    checkIssuedAt: payment.checkIssuedAt?.toISOString() ?? null,
    checkDueAt: payment.checkDueAt?.toISOString() ?? null,
    checkClearedAt: payment.checkClearedAt?.toISOString() ?? null,
    paidAt: payment.paidAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    cancelledAt: payment.cancelledAt?.toISOString() ?? null,
    invoice: payment.invoice
      ? {
          ...payment.invoice,
          total: payment.invoice.total.toString(),
        }
      : null,
  };
}

// GET /api/payments
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const contactId = searchParams.get("contactId");
    const invoiceId = searchParams.get("invoiceId");
    const search = searchParams.get("search")?.trim();
    const pagination = parseCursorPageParams(searchParams);

    if (!pagination) {
      return NextResponse.json(
        { error: "محدوده صفحه‌بندی معتبر نیست." },
        { status: 400 },
      );
    }

    if (type && !Object.values(PaymentType).includes(type as PaymentType)) {
      return NextResponse.json(
        { error: "نوع تراکنش نامعتبر است." },
        { status: 400 },
      );
    }

    if (
      status &&
      !Object.values(PaymentStatus).includes(status as PaymentStatus)
    ) {
      return NextResponse.json(
        { error: "وضعیت تراکنش نامعتبر است." },
        { status: 400 },
      );
    }

    const where: Prisma.PaymentWhereInput = {
        businessId: user.business.id,
        method: { not: PaymentMethod.LEDGER },
        ...(type ? { type: type as PaymentType } : {}),
        ...(status ? { status: status as PaymentStatus } : {}),
        ...(contactId ? { contactId } : {}),
        ...(invoiceId ? { invoiceId } : {}),
        ...(search
          ? {
              OR: [
                { trackingNumber: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                {
                  contact: {
                    name: { contains: search, mode: "insensitive" },
                  },
                },
                {
                  invoice: {
                    invoiceNumber: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            }
          : {}),
      };

    const [rows, total, groupedPayments] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true } },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              type: true,
              status: true,
              total: true,
            },
          },
        },
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
      }),
      prisma.payment.count({ where }),
      prisma.payment.groupBy({
        by: ["type", "status", "method", "checkClearedAt"] as const,
        where,
        orderBy: [{ type: "asc" }, { status: "asc" }, { method: "asc" }],
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const page = getCursorPage(rows, pagination.limit);
    const stats = groupedPayments.reduce(
      (result, group) => {
        if (group.status !== PaymentStatus.CONFIRMED) return result;
        const count =
          typeof group._count === "object" && group._count
            ? group._count._all ?? 0
            : 0;
        result.confirmedCount += count;
        if (group.method === PaymentMethod.CHECK && group.checkClearedAt === null) {
          return result;
        }
        if (group.type === PaymentType.RECEIPT) {
          result.receipts += group._sum?.amount ?? 0n;
        } else {
          result.payments += group._sum?.amount ?? 0n;
        }
        return result;
      },
      { receipts: 0n, payments: 0n, confirmedCount: 0 },
    );

    return NextResponse.json({
      payments: page.items.map(serializePayment),
      total,
      nextCursor: page.nextCursor,
      stats: {
        receipts: stats.receipts.toString(),
        payments: stats.payments.toString(),
        confirmedCount: stats.confirmedCount,
      },
    });
  } catch (error) {
    console.error("GET /api/payments error:", error);
    return NextResponse.json(
      { error: "خطا در دریافت تراکنش‌ها." },
      { status: 500 },
    );
  }
}

// POST /api/payments
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const parsed = paymentSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "اطلاعات واردشده معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    if (data.method === PaymentMethod.LEDGER) {
      return NextResponse.json(
        { error: "ثبت حساب دفتری فقط از طریق برنامه پرداخت فاکتور امکان‌پذیر است." },
        { status: 400 },
      );
    }
    if (data.checkIssuedAt && data.checkDueAt && data.checkDueAt < data.checkIssuedAt) {
      return NextResponse.json(
        { error: "تاریخ سررسید چک نمی‌تواند قبل از تاریخ صدور باشد." },
        { status: 400 },
      );
    }
    if (
      data.checkClearedAt &&
      (data.method !== PaymentMethod.CHECK ||
        (data.checkIssuedAt && data.checkClearedAt < data.checkIssuedAt))
    ) {
      return NextResponse.json(
        { error: "تاریخ پاس‌شدن باید برای چک و پس از تاریخ صدور آن باشد." },
        { status: 400 },
      );
    }
    const businessId = user.business.id;

    const business = await prisma.business.findFirst({
      where: { id: businessId, isActive: true },
      select: { id: true, currencyUnit: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار فعال پیدا نشد." },
        { status: 404 },
      );
    }

    const amount = toRial(BigInt(data.amount), business.currencyUnit);

    if (amount <= BigInt(0)) {
      return NextResponse.json(
        { error: "مبلغ پرداخت نامعتبر است." },
        { status: 400 },
      );
    }

    const payment = await prisma.$transaction(async (tx) => {
      let contactId = data.contactId || null;

      if (data.invoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: data.invoiceId, businessId },
          include: {
            contact: { select: { id: true } },
            salesReturns: { select: { total: true } },
            purchaseReturns: { select: { total: true } },
            payments: {
              where: { status: PaymentStatus.CONFIRMED },
                select: { amount: true, method: true, checkClearedAt: true },
            },
          },
        });

        if (!invoice) {
          throw new Error("INVOICE_NOT_FOUND");
        }

        if (invoice.status !== "ISSUED") {
          throw new Error("INVOICE_NOT_PAYABLE");
        }

        const expectedType =
          invoice.type === "SALE"
            ? PaymentType.RECEIPT
            : PaymentType.PAYMENT;

        if (data.type !== expectedType) {
          throw new Error("PAYMENT_TYPE_MISMATCH");
        }

        if (invoice.contactId) {
          if (contactId && contactId !== invoice.contactId) {
            throw new Error("CONTACT_MISMATCH");
          }

          contactId = invoice.contactId;
        }

        const alreadyPaid = invoice.payments.reduce(
          (sum, item) => item.method === PaymentMethod.LEDGER ||
            (item.method === PaymentMethod.CHECK && item.checkClearedAt === null)
            ? sum
            : sum + item.amount,
          BigInt(0),
        );

        const returnedAmount = [
          ...invoice.salesReturns,
          ...invoice.purchaseReturns,
        ].reduce((sum, item) => sum + item.total, 0n);
        if (alreadyPaid + amount + returnedAmount > invoice.total) {
          throw new Error("OVERPAYMENT");
        }
      }

      if (contactId) {
        const contact = await tx.contact.findFirst({
          where: { id: contactId, businessId },
          select: { id: true },
        });

        if (!contact) {
          throw new Error("CONTACT_NOT_FOUND");
        }
      }

      return tx.payment.create({
        data: {
          businessId,
          contactId,
          invoiceId: data.invoiceId || null,
          type: data.type,
          method: data.method,
          amount,
          trackingNumber: data.trackingNumber || null,
          checkNumber: data.method === PaymentMethod.CHECK
            ? data.checkNumber || data.trackingNumber || null
            : null,
          checkIssuedAt: data.method === PaymentMethod.CHECK && data.checkIssuedAt
            ? new Date(`${data.checkIssuedAt}T00:00:00.000Z`)
            : null,
          checkDueAt: data.method === PaymentMethod.CHECK && data.checkDueAt
            ? new Date(`${data.checkDueAt}T00:00:00.000Z`)
            : null,
          checkClearedAt: data.method === PaymentMethod.CHECK && data.checkClearedAt
            ? new Date(`${data.checkClearedAt}T00:00:00.000Z`)
            : null,
          payableTo: data.method === PaymentMethod.CHECK ? data.payableTo || null : null,
          destinationDetails:
            data.method === PaymentMethod.CARD_TO_CARD || data.method === PaymentMethod.POS
              ? data.destinationDetails || null
              : null,
          description: data.description || null,
          paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        },
        include: {
          contact: { select: { id: true, name: true } },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              type: true,
              status: true,
              total: true,
            },
          },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json(
      { payment: serializePayment(payment) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, string> = {
        INVOICE_NOT_FOUND: "فاکتور پیدا نشد.",
        INVOICE_NOT_PAYABLE: "فقط فاکتور صادرشده قابل پرداخت است.",
        PAYMENT_TYPE_MISMATCH:
          "نوع دریافت یا پرداخت با نوع فاکتور سازگار نیست.",
        CONTACT_MISMATCH:
          "طرف حساب انتخاب‌شده با طرف حساب فاکتور مطابقت ندارد.",
        CONTACT_NOT_FOUND: "طرف حساب پیدا نشد.",
        OVERPAYMENT: "مبلغ پرداخت از مانده فاکتور بیشتر است.",
      };

      if (messages[error.message]) {
        return NextResponse.json(
          { error: messages[error.message] },
          { status: 400 },
        );
      }
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        { error: "فاکتور هم‌زمان تغییر کرده؛ اطلاعات را تازه‌سازی کنید." },
        { status: 409 },
      );
    }

    console.error("POST /api/payments error:", error);
    return NextResponse.json(
      { error: "خطا در ثبت تراکنش." },
      { status: 500 },
    );
  }
}
