
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
});

type RouteContext = {
  params: Promise<{ categoryId: string }>;
};

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

// ویرایش دسته‌بندی
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { categoryId } = await params;
    const body = await request.json();
    const validation = updateCategorySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "نام دسته‌بندی معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await prisma.category.updateMany({
      where: {
        id: categoryId,
        businessId: auth.businessId!,
      },
      data: {
        name: validation.data.name,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { message: "دسته‌بندی پیدا نشد." },
        { status: 404 }
      );
    }

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        businessId: auth.businessId!,
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return NextResponse.json({
      message: "دسته‌بندی با موفقیت ویرایش شد.",
      category,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "دسته‌بندی دیگری با این نام وجود دارد." },
        { status: 409 }
      );
    }

    console.error("Update category error:", error);

    return NextResponse.json(
      { message: "خطا در ویرایش دسته‌بندی." },
      { status: 500 }
    );
  }
}

// حذف دسته‌بندی فقط در صورت نداشتن کالای متصل
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { categoryId } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({
        where: {
          id: categoryId,
          businessId: auth.businessId!,
        },
        select: {
          id: true,
          _count: {
            select: { products: true },
          },
        },
      });

      if (!category) {
        throw new Error("CATEGORY_NOT_FOUND");
      }

      if (category._count.products > 0) {
        throw new Error("CATEGORY_HAS_PRODUCTS");
      }

      await tx.category.delete({
        where: { id: category.id },
      });

      return true;
    });

    if (result) {
      return NextResponse.json({
        message: "دسته‌بندی با موفقیت حذف شد.",
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CATEGORY_NOT_FOUND") {
        return NextResponse.json(
          { message: "دسته‌بندی پیدا نشد." },
          { status: 404 }
        );
      }

      if (error.message === "CATEGORY_HAS_PRODUCTS") {
        return NextResponse.json(
          {
            message: "این دسته‌بندی دارای کالا است؛ ابتدا کالاهای آن را به دسته‌بندی دیگری منتقل کنید.",
          },
          { status: 409 }
        );
      }
    }

    console.error("Delete category error:", error);

    return NextResponse.json(
      { message: "خطا در حذف دسته‌بندی." },
      { status: 500 }
    );
  }
}
