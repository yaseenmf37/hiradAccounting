
import { NextRequest, NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const cancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

type RouteContext = {
  params: Promise<{ paymentId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ error: "دسترسی غیرمجاز است." }, { status: 401 });
    }

    const { paymentId } = await context.params;
    const parsed = cancelSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "دلیل لغو باید حداقل ۳ و حداکثر ۵۰۰ کاراکتر باشد." },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          businessId: user.business!.id,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!payment) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      if (payment.status !== PaymentStatus.CONFIRMED) {
        throw new Error("PAYMENT_ALREADY_CANCELLED");
      }

      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          businessId: user.business!.id,
          status: PaymentStatus.CONFIRMED,
        },
        data: {
          status: PaymentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: parsed.data.reason,
        },
      });

      if (updated.count !== 1) {
        throw new Error("PAYMENT_ALREADY_CANCELLED");
      }

      return tx.payment.findFirstOrThrow({
        where: {
          id: paymentId,
          businessId: user.business!.id,
        },
      });
    });

    return NextResponse.json({
      message: "تراکنش با موفقیت لغو شد.",
      payment: {
        ...result,
        amount: result.amount.toString(),
        paidAt: result.paidAt.toISOString(),
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        cancelledAt: result.cancelledAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PAYMENT_NOT_FOUND") {
        return NextResponse.json({ error: "تراکنش پیدا نشد." }, { status: 404 });
      }

      if (error.message === "PAYMENT_ALREADY_CANCELLED") {
        return NextResponse.json({ error: "این تراکنش قبلاً لغو شده است." }, { status: 409 });
      }
    }

    console.error("POST /api/payments/[paymentId]/cancel error:", error);
    return NextResponse.json({ error: "خطا در لغو تراکنش." }, { status: 500 });
  }
}

