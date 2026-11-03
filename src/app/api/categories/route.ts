import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
});

async function authorize() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      response: NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      ),
      businessId: null,
    };
  }

  if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      response: NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      ),
      businessId: null,
    };
  }

  return {
    response: null,
    businessId: user.business.id,
  };
}

// دریافت دسته‌بندی‌ها
export async function GET() {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const categories = await prisma.category.findMany({
      where: {
        businessId: auth.businessId!,
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Get categories error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت دسته‌بندی‌ها." },
      { status: 500 }
    );
  }
}

// ایجاد دسته‌بندی
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const body = await request.json();
    const validation = categorySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "نام دسته‌بندی معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const category = await prisma.category.create({
      data: {
        businessId: auth.businessId!,
        name: validation.data.name,
      },
    });

    return NextResponse.json(
      {
        message: "دسته‌بندی با موفقیت ایجاد شد.",
        category,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "این دسته‌بندی قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    console.error("Create category error:", error);

    return NextResponse.json(
      { message: "خطا در ایجاد دسته‌بندی." },
      { status: 500 }
    );
  }
}