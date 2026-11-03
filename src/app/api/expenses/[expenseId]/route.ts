import { NextResponse } from "next/server";
import {
  ExpenseCategory,
  ExpenseStatus,
  PaymentMethod,
} from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";

type RouteContext = {
  params: Promise<{ expenseId: string }>;
};

const updateExpenseSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  category: z.nativeEnum(ExpenseCategory).optional(),
  amount: z.number().int().positive().safe().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  spentAt: z.string().datetime().optional(),
});

const cancelExpenseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

function serializeExpense(expense: {
  id: string;
  businessId: string;
  title: string;
  category: ExpenseCategory;
  amount: bigint;
  method: PaymentMethod;
  status: ExpenseStatus;
  description: string | null;
  spentAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
}) {
  return {
    ...expense,
    amount: expense.amount.toString(),
    spentAt: expense.spentAt.toISOString(),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    cancelledAt: expense.cancelledAt?.toISOString() ?? null,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const { expenseId } = await context.params;
    const parsed = updateExpenseSchema.safeParse(await request.json());

    if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
      return NextResponse.json(
        { error: "اطلاعات ویرایش هزینه معتبر نیست." },
        { status: 400 },
      );
    }

    const business = user.business;

    const existing = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        businessId: business.id,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "هزینه پیدا نشد." },
        { status: 404 },
      );
    }

    if (existing.status !== ExpenseStatus.CONFIRMED) {
      return NextResponse.json(
        { error: "هزینه لغوشده قابل ویرایش نیست." },
        { status: 409 },
      );
    }

    const data = parsed.data;

    const spentAt = data.spentAt ? new Date(data.spentAt) : undefined;

    if (spentAt && Number.isNaN(spentAt.getTime())) {
      return NextResponse.json(
        { error: "تاریخ هزینه معتبر نیست." },
        { status: 400 },
      );
    }

      const result = await prisma.expense.updateMany({
        where: {
          id: existing.id,
          businessId: business.id,
          status: ExpenseStatus.CONFIRMED,
        },
        data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.amount !== undefined
          ? { amount: toRial(BigInt(data.amount), business.currencyUnit) }
          : {}),
        ...(data.method !== undefined ? { method: data.method } : {}),
        ...(data.description !== undefined
          ? { description: data.description || null }
          : {}),
        ...(spentAt ? { spentAt } : {}),
      },
    });

    if (result.count === 0) {
  return NextResponse.json(
    { error: "هزینه تغییر کرده یا قابل ویرایش نیست." },
    { status: 409 },
  );
}

const expense = await prisma.expense.findFirst({
  where: {
    id: existing.id,
    businessId: business.id,
  },
});

if (!expense) {
  return NextResponse.json(
    { error: "هزینه پیدا نشد." },
    { status: 404 },
  );
}

    return NextResponse.json({ expense: serializeExpense(expense) });
  } catch (error) {
    console.error("PATCH /api/expenses/[expenseId] error:", error);

    return NextResponse.json(
      { error: "خطا در ویرایش هزینه." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const { expenseId } = await context.params;
    const parsed = cancelExpenseSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "دلیل لغو معتبر نیست." },
        { status: 400 },
      );
    }

    const result = await prisma.expense.updateMany({
      where: {
        id: expenseId,
        businessId: user.business.id,
        status: ExpenseStatus.CONFIRMED,
      },
      data: {
        status: ExpenseStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: parsed.data.reason,
      },
    });

    if (result.count === 0) {
      const existing = await prisma.expense.findFirst({
        where: {
          id: expenseId,
          businessId: user.business.id,
        },
        select: { id: true, status: true },
      });

      if (!existing) {
        return NextResponse.json(
          { error: "هزینه پیدا نشد." },
          { status: 404 },
        );
      }

      return NextResponse.json(
        { error: "این هزینه قبلاً لغو شده است." },
        { status: 409 },
      );
    }

    const expense = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        businessId: user.business.id,
      },
    });

    return NextResponse.json({
      expense: expense ? serializeExpense(expense) : null,
    });
  } catch (error) {
    console.error("POST /api/expenses/[expenseId] cancel error:", error);

    return NextResponse.json(
      { error: "خطا در لغو هزینه." },
      { status: 500 },
    );
  }
}