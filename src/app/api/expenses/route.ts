import { NextResponse } from "next/server";
import {
  ExpenseCategory,
  ExpenseStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

const createExpenseSchema = z.object({
  title: z.string().trim().min(2).max(150),
  category: z.nativeEnum(ExpenseCategory),
  amount: z.number().int().positive().safe(),
  method: z.nativeEnum(PaymentMethod).refine(
    (method) => method !== PaymentMethod.LEDGER,
  ),
  description: z.string().trim().max(1000).optional().nullable(),
  spentAt: z.string().datetime().optional(),
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

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const businessId = user.business.id;
    const { searchParams } = new URL(request.url);

    const category = searchParams.get("category");
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim();
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const pagination = parseCursorPageParams(searchParams);

    if (!pagination) {
      return NextResponse.json(
        { error: "محدوده صفحه‌بندی معتبر نیست." },
        { status: 400 },
      );
    }

    if (
      category &&
      category !== "ALL" &&
      !Object.values(ExpenseCategory).includes(category as ExpenseCategory)
    ) {
      return NextResponse.json(
        { error: "دسته‌بندی هزینه معتبر نیست." },
        { status: 400 },
      );
    }

    if (
      status &&
      status !== "ALL" &&
      !Object.values(ExpenseStatus).includes(status as ExpenseStatus)
    ) {
      return NextResponse.json(
        { error: "وضعیت هزینه معتبر نیست." },
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
        { error: "بازه تاریخی معتبر نیست." },
        { status: 400 },
      );
    }

    const where: Prisma.ExpenseWhereInput = {
        businessId,
        ...(category && category !== "ALL"
          ? { category: category as ExpenseCategory }
          : {}),
        ...(status && status !== "ALL"
          ? { status: status as ExpenseStatus }
          : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(startDate || endDate
          ? {
              spentAt: {
                ...(startDate
                  ? { gte: new Date(`${startDate}T00:00:00.000Z`) }
                  : {}),
                ...(endDate
                  ? { lte: new Date(`${endDate}T23:59:59.999Z`) }
                  : {}),
              },
            }
          : {}),
      };

    const [rows, total, groupedStats] = await prisma.$transaction([
      prisma.expense.findMany({
        where,
        orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
      }),
      prisma.expense.count({ where }),
      prisma.expense.groupBy({
        by: ["status"] as const,
        where,
        orderBy: { status: "asc" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const page = getCursorPage(rows, pagination.limit);
    const stats = groupedStats.reduce(
      (result, group) => {
        const count =
          typeof group._count === "object" && group._count
            ? group._count._all ?? 0
            : 0;
        result.count += count;
        if (group.status === ExpenseStatus.CONFIRMED) {
          result.confirmed += count;
          result.total += group._sum?.amount ?? 0n;
        } else {
          result.cancelled += count;
        }
        return result;
      },
      { count: 0, confirmed: 0, cancelled: 0, total: 0n },
    );

    return NextResponse.json({
      expenses: page.items.map(serializeExpense),
      total,
      nextCursor: page.nextCursor,
      stats: {
        count: stats.confirmed,
        confirmed: stats.confirmed,
        cancelled: stats.cancelled,
        total: stats.total.toString(),
      },
    });
  } catch (error) {
    console.error("GET /api/expenses error:", error);

    return NextResponse.json(
      { error: "خطا در دریافت هزینه‌ها." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 401 },
      );
    }

    const body = await request.json();
    const parsed = createExpenseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "اطلاعات هزینه معتبر نیست.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const business = user.business;

    const amount = toRial(BigInt(data.amount), business.currencyUnit);

    const spentAt = data.spentAt
      ? new Date(data.spentAt)
      : new Date();

    if (Number.isNaN(spentAt.getTime())) {
      return NextResponse.json(
        { error: "تاریخ هزینه معتبر نیست." },
        { status: 400 },
      );
    }

    const expense = await prisma.expense.create({
      data: {
        businessId: business.id,
        title: data.title,
        category: data.category,
        amount,
        method: data.method,
        description: data.description || null,
        spentAt,
      },
    });

    return NextResponse.json(
      { expense: serializeExpense(expense) },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/expenses error:", error);

    return NextResponse.json(
      { error: "خطا در ثبت هزینه." },
      { status: 500 },
    );
  }
}