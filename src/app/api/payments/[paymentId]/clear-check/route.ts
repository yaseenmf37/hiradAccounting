import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ paymentId: string }>;
};

const bodySchema = z.object({
  checkClearedAt: z.string().date(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business || !user.business.isActive) {
      return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 401 });
    }
    const businessId = user.business.id;

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "تاریخ پاس‌شدن چک معتبر نیست." }, { status: 400 });
    }

    const { paymentId } = await context.params;
    const checkClearedAt = new Date(`${parsed.data.checkClearedAt}T00:00:00.000Z`);
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, businessId },
        select: {
          method: true,
          status: true,
          amount: true,
          invoiceId: true,
          checkIssuedAt: true,
          checkClearedAt: true,
          invoice: {
            select: {
              total: true,
              salesReturns: { select: { total: true } },
              purchaseReturns: { select: { total: true } },
              payments: {
                where: { status: PaymentStatus.CONFIRMED },
                select: { id: true, amount: true, method: true, checkClearedAt: true },
              },
            },
          },
        },
      });

      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      if (payment.method !== PaymentMethod.CHECK || payment.status !== PaymentStatus.CONFIRMED) {
        throw new Error("CHECK_NOT_CLEARABLE");
      }
      if (payment.checkClearedAt) throw new Error("CHECK_ALREADY_CLEARED");
      if (payment.checkIssuedAt && checkClearedAt < payment.checkIssuedAt) {
        throw new Error("CLEAR_DATE_BEFORE_ISSUE");
      }

      if (payment.invoiceId && payment.invoice) {
        const alreadyPaid = payment.invoice.payments.reduce(
          (sum, item) => item.id === paymentId ||
            item.method === PaymentMethod.LEDGER ||
            (item.method === PaymentMethod.CHECK && item.checkClearedAt === null)
            ? sum
            : sum + item.amount,
          0n,
        );
        const returnedAmount = [
          ...payment.invoice.salesReturns,
          ...payment.invoice.purchaseReturns,
        ].reduce((sum, item) => sum + item.total, 0n);
        if (alreadyPaid + payment.amount + returnedAmount > payment.invoice.total) {
          throw new Error("CHECK_EXCEEDS_BALANCE");
        }
      }

      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          businessId,
          method: PaymentMethod.CHECK,
          status: PaymentStatus.CONFIRMED,
          checkClearedAt: null,
        },
        data: { checkClearedAt },
      });
      if (updated.count !== 1) throw new Error("CHECK_ALREADY_CLEARED");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ checkClearedAt: checkClearedAt.toISOString() });
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, { message: string; status: number }> = {
        PAYMENT_NOT_FOUND: { message: "تراکنش پیدا نشد.", status: 404 },
        CHECK_NOT_CLEARABLE: { message: "فقط چک تأییدشده قابل ثبت به‌عنوان پاس‌شده است.", status: 400 },
        CHECK_ALREADY_CLEARED: { message: "تاریخ پاس‌شدن این چک قبلاً ثبت شده است.", status: 409 },
        CLEAR_DATE_BEFORE_ISSUE: { message: "تاریخ پاس‌شدن نمی‌تواند قبل از صدور چک باشد.", status: 400 },
        CHECK_EXCEEDS_BALANCE: { message: "پاس‌شدن چک باعث بیشترشدن پرداخت از مانده فاکتور می‌شود.", status: 409 },
      };
      const known = errors[error.message];
      if (known) return NextResponse.json({ error: known.message }, { status: known.status });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json({ error: "تراکنش هم‌زمان تغییر کرده است؛ وضعیت را تازه‌سازی کنید." }, { status: 409 });
    }
    console.error("POST /api/payments/[paymentId]/clear-check error:", error);
    return NextResponse.json({ error: "خطا در ثبت پاس‌شدن چک." }, { status: 500 });
  }
}
