import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";

const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  purchasePrice: z.string().regex(/^\d+$/).optional(),
  salePrice: z.string().regex(/^\d+$/).optional(),
  minStock: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
  isActive: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{ productId: string }>;
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

function serializeProduct(product: {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  purchasePrice: bigint;
  salePrice: bigint;
  averageCost: Prisma.Decimal;
  inventoryValue: bigint;
  stock: Prisma.Decimal;
  minStock: Prisma.Decimal;
  isActive: boolean;
  category: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...product,
    purchasePrice: product.purchasePrice.toString(),
    salePrice: product.salePrice.toString(),
    averageCost: product.averageCost.toString(),
    inventoryValue: product.inventoryValue.toString(),
    stock: product.stock.toString(),
    minStock: product.minStock.toString(),
  };
}

// دریافت اطلاعات کالا
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { productId } = await params;

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        businessId: auth.businessId!,
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { message: "کالا پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("Get product error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت اطلاعات کالا." },
      { status: 500 }
    );
  }
}

// ویرایش کالا
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { productId } = await params;
    const body = await request.json();

    const validation = updateProductSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات واردشده معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const businessId = auth.businessId!;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { currencyUnit: true },
    });

    if (!business) {
      return NextResponse.json(
        { message: "کسب‌وکار پیدا نشد." },
        { status: 404 }
      );
    }

    const existingProduct = await prisma.product.findFirst({
      where: {
        id: productId,
        businessId,
      },
      select: { id: true },
    });

    if (!existingProduct) {
      return NextResponse.json(
        { message: "کالا پیدا نشد." },
        { status: 404 }
      );
    }

    if (data.categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: data.categoryId,
          businessId,
        },
        select: { id: true },
      });

      if (!category) {
        return NextResponse.json(
          { message: "دسته‌بندی انتخاب‌شده معتبر نیست." },
          { status: 400 }
        );
      }
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sku !== undefined && { sku: data.sku || null }),
        ...(data.barcode !== undefined && {
          barcode: data.barcode || null,
        }),
        ...(data.categoryId !== undefined && {
          categoryId: data.categoryId || null,
        }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.purchasePrice !== undefined && {
          purchasePrice: toRial(
            BigInt(data.purchasePrice),
            business.currencyUnit
          ),
        }),
        ...(data.salePrice !== undefined && {
          salePrice: toRial(
            BigInt(data.salePrice),
            business.currencyUnit
          ),
        }),
        ...(data.minStock !== undefined && {
          minStock: new Prisma.Decimal(data.minStock),
        }),
        ...(data.isActive !== undefined && {
          isActive: data.isActive,
        }),
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({
      message: "اطلاعات کالا با موفقیت ویرایش شد.",
      product: serializeProduct(product),
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "کد کالا یا بارکد قبلاً ثبت شده است." },
        { status: 409 }
      );
    }

    console.error("Update product error:", error);

    return NextResponse.json(
      { message: "خطا در ویرایش کالا." },
      { status: 500 }
    );
  }
}

// آرشیو کالا
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { productId } = await params;

    const result = await prisma.product.updateMany({
      where: {
        id: productId,
        businessId: auth.businessId!,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { message: "کالا پیدا نشد یا قبلاً آرشیو شده است." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "کالا با موفقیت آرشیو شد.",
    });
  } catch (error) {
    console.error("Archive product error:", error);

    return NextResponse.json(
      { message: "خطا در آرشیو کالا." },
      { status: 500 }
    );
  }
}