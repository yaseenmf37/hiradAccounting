
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { message: "نام کاربری یا رمز عبور نامعتبر است." },
        { status: 400 }
      );
    }

    const { username, password } = validation.data;

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        business: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { message: "نام کاربری یا رمز عبور اشتباه است." },
        { status: 401 }
      );
    }

    const passwordIsValid = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordIsValid || !user.isActive) {
      return NextResponse.json(
        { message: "نام کاربری یا رمز عبور اشتباه است." },
        { status: 401 }
      );
    }

    if (
      user.role === "BUSINESS_OWNER" &&
      (!user.business || !user.business.isActive)
    ) {
      return NextResponse.json(
        { message: "حساب کسب‌وکار شما غیرفعال است." },
        { status: 403 }
      );
    }

    await createSession(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        business: user.business
          ? {
              id: user.business.id,
              name: user.business.name,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      { message: "خطای داخلی سرور رخ داد." },
      { status: 500 }
    );
  }
}
