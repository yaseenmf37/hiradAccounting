import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "احراز هویت انجام نشده است." },
        { status: 401 }
      );
    }

    if (user.role !== "BUSINESS_OWNER" || !user.business) {
      return NextResponse.json(
        { error: "دسترسی به این عملیات مجاز نیست." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const currencyUnit = body?.currencyUnit;

    if (currencyUnit !== "RIAL" && currencyUnit !== "TOMAN") {
      return NextResponse.json(
        { error: "واحد پول انتخاب‌شده معتبر نیست." },
        { status: 400 }
      );
    }

    const result = await prisma.business.updateMany({
      where: {
        id: user.business.id,
      },
      data: {
        currencyUnit,
      },
    });

    if (result.count !== 1) {
      return NextResponse.json(
        { error: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      currencyUnit,
      message: "واحد پول با موفقیت تغییر کرد.",
    });
  } catch (error) {
    console.error("UPDATE_CURRENCY_ERROR:", error);

    return NextResponse.json(
      { error: "تغییر واحد پول ناموفق بود." },
      { status: 500 }
    );
  }
}