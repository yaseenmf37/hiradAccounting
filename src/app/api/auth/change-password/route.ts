
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, getCurrentUser } from "@/lib/auth";

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12).max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "تکرار رمز عبور با رمز جدید مطابقت ندارد.",
    path: ["confirmPassword"],
  });

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");

    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json(
        { error: "درخواست غیرمجاز است." },
        { status: 403 }
      );
    }

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "ابتدا وارد حساب کاربری شوید." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = schema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0]?.message || "اطلاعات نامعتبر است." },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = validation.data;

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "حساب کاربری پیدا نشد." },
        { status: 404 }
      );
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      account.passwordHash
    );

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "رمز عبور فعلی اشتباه است." },
        { status: 400 }
      );
    }

    const samePassword = await bcrypt.compare(
      newPassword,
      account.passwordHash
    );

    if (samePassword) {
      return NextResponse.json(
        { error: "رمز جدید باید با رمز فعلی متفاوت باشد." },
        { status: 400 }
      );
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
        },
      }),
      prisma.session.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    await createSession(user.id);

    return NextResponse.json({
      success: true,
      message: "رمز عبور با موفقیت تغییر کرد.",
    });
  } catch (error) {
    console.error("CHANGE_PASSWORD_ERROR:", error);

    return NextResponse.json(
      { error: "خطا در تغییر رمز عبور." },
      { status: 500 }
    );
  }
}
