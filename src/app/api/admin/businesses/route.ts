
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional(),
  ownerUsername: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]{3,40}$/),
  ownerFullName: z.string().trim().min(2).max(100),
  ownerPassword: z.string().min(12).max(200),
});

export async function POST(request: NextRequest) {
  try {
    // بررسی دسترسی مدیر کل
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { message: "ابتدا وارد حساب شوید." },
        { status: 401 }
      );
    }

    if (currentUser.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { message: "شما اجازه انجام این عملیات را ندارید." },
        { status: 403 }
      );
    }

    // اعتبارسنجی اطلاعات ورودی
    const body = await request.json();
    const validation = createBusinessSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { message: "اطلاعات واردشده معتبر نیست." },
        { status: 400 }
      );
    }

    const {
      businessName,
      phone,
      ownerUsername,
      ownerFullName,
      ownerPassword,
    } = validation.data;

    // بررسی تکراری نبودن نام کاربری
    const existingUser = await prisma.user.findUnique({
      where: { username: ownerUsername },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "این نام کاربری قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    // رمزنگاری رمز عبور
    const passwordHash = await bcrypt.hash(ownerPassword, 12);

    // ساخت مدیر و کسب‌وکار به‌صورت اتمیک
    const result = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: {
          username: ownerUsername,
          fullName: ownerFullName,
          passwordHash,
          role: "BUSINESS_OWNER",
          isActive: true,
          mustChangePassword: true,
        },
      });

      const business = await tx.business.create({
        data: {
          name: businessName,
          phone: phone || null,
          isActive: true,
          ownerId: owner.id,
        },
      });

      return { owner, business };
    });

    return NextResponse.json(
      {
        message: "کسب‌وکار با موفقیت ایجاد شد.",
        business: {
          id: result.business.id,
          name: result.business.name,
          phone: result.business.phone,
          isActive: result.business.isActive,
          createdAt: result.business.createdAt,
        },
        owner: {
          id: result.owner.id,
          username: result.owner.username,
          fullName: result.owner.fullName,
          mustChangePassword: result.owner.mustChangePassword,
        },
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
        { message: "این نام کاربری قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    console.error("Create business error:", error);

    return NextResponse.json(
      { message: "خطای داخلی سرور رخ داد." },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { message: "ابتدا وارد حساب شوید." },
        { status: 401 }
      );
    }

    if (currentUser.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { message: "شما اجازه مشاهده این اطلاعات را ندارید." },
        { status: 403 }
      );
    }

    const businesses = await prisma.business.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        phone: true,
        isActive: true,
        createdAt: true,
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            isActive: true,
          },
        },
        _count: {
          select: {
            products: true,
            contacts: true,
            invoices: true,
          },
        },
      },
    });

    return NextResponse.json({
      businesses,
      total: businesses.length,
    });
  } catch (error) {
    console.error("Get businesses error:", error);

    return NextResponse.json(
      { message: "خطای داخلی سرور رخ داد." },
      { status: 500 }
    );
  }
}
