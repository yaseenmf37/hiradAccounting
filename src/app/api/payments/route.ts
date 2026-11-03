
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { toRial } from "@/lib/currency";
import { prisma } from "@/lib/prisma";

const paymentSchema = z.object({
  contactId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  type: z.nativeEnum(PaymentType),
  method: z.nativeEnum(PaymentMethod),
  amount: z.number().int().positive().safe(),
  trackingNumber: z.string().trim().max(100).optional().nullable(),
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

    const payments = await prisma.payment.findMany({
      where: {
        businessId: user.business.id,
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
      orderBy: { paidAt: "desc" },
    });

    return NextResponse.json({
      payments: payments.map(serializePayment),
      total: payments.length,
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
            payments: {
              where: { status: PaymentStatus.CONFIRMED },
              select: { amount: true },
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
          (sum, item) => sum + item.amount,
          BigInt(0),
        );

        if (alreadyPaid + amount > invoice.total) {
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
    });

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

    console.error("POST /api/payments error:", error);
    return NextResponse.json(
      { error: "خطا در ثبت تراکنش." },
      { status: 500 },
    );
  }
}
