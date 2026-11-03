import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";

const movementSchema = z.object({
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitCost: z.string().regex(/^\d+$/).optional(),
  description: z.string().trim().max(500).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.type === "ADJUSTMENT_IN" && data.unitCost === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unitCost"],
      message: "قیمت واحد خرید برای ورود کالا الزامی است.",
    });
  }
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
      currencyUnit: null,
    };
  }

  if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      response: NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      ),
      businessId: null,
      currencyUnit: null,
    };
  }

  return {
    response: null,
    businessId: user.business.id,
    currencyUnit: user.business.currencyUnit,
  };
}

function serializeMovement(movement: {
  id: string;
  type: string;
  quantity: Prisma.Decimal;
  totalCost: bigint;
  averageCost: Prisma.Decimal;
  description: string | null;
  createdAt: Date;
  invoiceId: string | null;
}) {
  return {
    ...movement,
    quantity: movement.quantity.toString(),
    totalCost: movement.totalCost.toString(),
    averageCost: movement.averageCost.toString(),
  };
}

// دریافت تاریخچه گردش کالا
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { productId } = await params;
    const businessId = auth.businessId!;

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        businessId,
      },
      select: { id: true },
    });

    if (!product) {
      return NextResponse.json(
        { message: "کالا پیدا نشد." },
        { status: 404 }
      );
    }

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        productId,
        businessId,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        quantity: true,
        totalCost: true,
        averageCost: true,
        description: true,
        createdAt: true,
        invoiceId: true,
      },
    });

    return NextResponse.json({
      movements: movements.map(serializeMovement),
    });
  } catch (error) {
    console.error("Get inventory movements error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت تاریخچه انبار." },
      { status: 500 }
    );
  }
}

// ثبت ورود یا خروج دستی موجودی
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { productId } = await params;
    const businessId = auth.businessId!;
    const currencyUnit = auth.currencyUnit!;

    const body = await request.json();
    const validation = movementSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات گردش انبار معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const quantity = new Prisma.Decimal(data.quantity);

    if (!quantity.greaterThan(0)) {
      return NextResponse.json(
        { message: "مقدار باید بیشتر از صفر باشد." },
        { status: 400 }
      );
    }

    const isIncoming = data.type === "ADJUSTMENT_IN";

    const unitCost = isIncoming
      ? toRial(BigInt(data.unitCost!), currencyUnit)
      : BigInt(0);

    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findFirst({
          where: {
            id: productId,
            businessId,
          },
          select: {
            id: true,
            stock: true,
            averageCost: true,
            inventoryValue: true,
            isActive: true,
          },
        });

        if (!product) throw new Error("PRODUCT_NOT_FOUND");
        if (!product.isActive) throw new Error("PRODUCT_ARCHIVED");

        const newStock = isIncoming
          ? product.stock.add(quantity)
          : product.stock.sub(quantity);

        if (newStock.lessThan(0)) {
          throw new Error("INSUFFICIENT_STOCK");
        }

        let totalCost: bigint;
        let newInventoryValue: bigint;
        let newAverageCost: Prisma.Decimal;

        if (isIncoming) {
          const incomingCost = quantity
            .mul(unitCost.toString())
            .toFixed(0, Prisma.Decimal.ROUND_HALF_UP);

          totalCost = BigInt(incomingCost);
          newInventoryValue = product.inventoryValue + totalCost;

          newAverageCost = new Prisma.Decimal(
            newInventoryValue.toString()
          ).div(newStock);
        } else {
          totalCost = quantity.equals(product.stock)
            ? product.inventoryValue
            : BigInt(
                product.averageCost
                  .mul(quantity)
                  .toFixed(0, Prisma.Decimal.ROUND_HALF_UP)
              );

          if (totalCost > product.inventoryValue) {
            totalCost = product.inventoryValue;
          }

          newInventoryValue = product.inventoryValue - totalCost;

          newAverageCost = newStock.isZero()
            ? new Prisma.Decimal(0)
            : product.averageCost;
        }

        const updated = await tx.product.updateMany({
          where: {
            id: productId,
            businessId,
            stock: product.stock,
            averageCost: product.averageCost,
            inventoryValue: product.inventoryValue,
            isActive: true,
          },
          data: {
            stock: newStock,
            inventoryValue: newInventoryValue,
            averageCost: newAverageCost,
          },
        });

        if (updated.count !== 1) {
          throw new Error("STOCK_CONFLICT");
        }

        const movement = await tx.inventoryMovement.create({
          data: {
            businessId,
            productId,
            type: data.type,
            quantity,
            totalCost,
            averageCost: newAverageCost,
            description: data.description || null,
          },
        });

        return {
          stock: newStock.toString(),
          inventoryValue: newInventoryValue.toString(),
          averageCost: newAverageCost.toString(),
          movement: serializeMovement(movement),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    return NextResponse.json(
      {
        message: "گردش موجودی با موفقیت ثبت شد.",
        ...result,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, { message: string; status: number }> = {
        PRODUCT_NOT_FOUND: {
          message: "کالا پیدا نشد.",
          status: 404,
        },
        PRODUCT_ARCHIVED: {
          message: "برای کالای آرشیوشده نمی‌توان گردش جدید ثبت کرد.",
          status: 400,
        },
        INSUFFICIENT_STOCK: {
          message: "موجودی کافی نیست و خروج باعث منفی شدن موجودی می‌شود.",
          status: 409,
        },
        STOCK_CONFLICT: {
          message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید.",
          status: 409,
        },
      };

      const knownError = errors[error.message];

      if (knownError) {
        return NextResponse.json(
          { message: knownError.message },
          { status: knownError.status }
        );
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return NextResponse.json(
          { message: "موجودی هم‌زمان تغییر کرده است. دوباره تلاش کنید." },
          { status: 409 }
        );
      }
    }

    console.error("Create inventory movement error:", error);

    return NextResponse.json(
      { message: "خطا در ثبت گردش انبار." },
      { status: 500 }
    );
  }
}