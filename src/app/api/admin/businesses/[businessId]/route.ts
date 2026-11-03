
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

const schema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "احراز هویت لازم است." },
        { status: 401 }
      );
    }

    if (user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 403 }
      );
    }

    const { businessId } = await params;
    const body = await request.json();
    const validation = schema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "اطلاعات ارسالی معتبر نیست." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, ownerId: true },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const { isActive } = validation.data;

    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: { isActive },
      });

      await tx.user.update({
        where: { id: business.ownerId },
        data: { isActive },
      });

      if (!isActive) {
        await tx.session.deleteMany({
          where: { userId: business.ownerId },
        });
      }
    });

    return NextResponse.json({
      success: true,
      isActive,
    });
  } catch (error) {
    console.error("BUSINESS_STATUS_UPDATE_ERROR:", error);

    return NextResponse.json(
      { error: "خطا در تغییر وضعیت کسب‌وکار." },
      { status: 500 }
    );
  }
}


export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ businessId: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "احراز هویت لازم است." },
        { status: 401 }
      );
    }

    if (user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "دسترسی غیرمجاز است." },
        { status: 403 }
      );
    }

    const { businessId } = await params;
    const body = await request.json();

    const schema = z.object({
      businessName: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(30),
      ownerUsername: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9_.-]{3,40}$/),
      ownerFullName: z.string().trim().min(2).max(100),
    });

    const validation = schema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "اطلاعات واردشده معتبر نیست." },
        { status: 400 }
      );
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!business) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const {
      businessName,
      phone,
      ownerUsername,
      ownerFullName,
    } = validation.data;

    const usernameExists = await prisma.user.findFirst({
      where: {
        username: ownerUsername,
        id: { not: business.ownerId },
      },
      select: { id: true },
    });

    if (usernameExists) {
      return NextResponse.json(
        { error: "این نام کاربری قبلاً استفاده شده است." },
        { status: 409 }
      );
    }

    await prisma.$transaction([
      prisma.business.update({
        where: { id: businessId },
        data: {
          name: businessName,
          phone: phone || null,
        },
      }),
      prisma.user.update({
        where: { id: business.ownerId },
        data: {
          username: ownerUsername,
          fullName: ownerFullName,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "اطلاعات با موفقیت ویرایش شد.",
    });
  } catch (error) {
    console.error("BUSINESS_UPDATE_ERROR:", error);

    return NextResponse.json(
      { error: "خطا در ویرایش اطلاعات کسب‌وکار." },
      { status: 500 }
    );
  }
}

