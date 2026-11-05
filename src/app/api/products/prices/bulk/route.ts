import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(500),
  field: z.enum(["PURCHASE", "SALE"]),
  percent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
      return NextResponse.json({ message: "دسترسی غیرمجاز است." }, { status: 401 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "اطلاعات افزایش قیمت معتبر نیست." }, { status: 400 });
    }
    const { productIds, field, percent } = parsed.data;
    const basisPoints = new Prisma.Decimal(percent).mul(100).toNumber();
    if (!Number.isInteger(basisPoints) || basisPoints <= 0 || basisPoints > 99999) {
      return NextResponse.json({ message: "درصد افزایش باید بیشتر از صفر و حداکثر ۹۹۹٫۹۹ باشد." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: user.business!.id },
        select: { id: true },
      });
      if (!business) throw new Error("BUSINESS_NOT_FOUND");
      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(productIds)] }, businessId: user.business!.id, isActive: true },
        select: { id: true, name: true, purchasePrice: true, salePrice: true },
      });
      if (products.length !== new Set(productIds).size) throw new Error("PRODUCT_NOT_FOUND");

      const updated = [];
      for (const product of products) {
        const oldPrice = field === "PURCHASE" ? product.purchasePrice : product.salePrice;
        const newPrice = (oldPrice * BigInt(10000 + basisPoints) + 5000n) / 10000n;
        if (newPrice > 9_223_372_036_854_775_807n) throw new Error("PRICE_OVERFLOW");
        const changed = await tx.product.updateMany({
          where: {
            id: product.id,
            businessId: user.business!.id,
            ...(field === "PURCHASE" ? { purchasePrice: oldPrice } : { salePrice: oldPrice }),
          },
          data: field === "PURCHASE" ? { purchasePrice: newPrice } : { salePrice: newPrice },
        });
        if (changed.count !== 1) throw new Error("PRICE_CONFLICT");
        await tx.productPriceHistory.create({
          data: {
            businessId: user.business!.id,
            productId: product.id,
            field,
            oldPrice,
            newPrice,
            increaseBasisPoints: basisPoints,
          },
        });
        updated.push({
          id: product.id,
          name: product.name,
          oldPrice: oldPrice.toString(),
          newPrice: newPrice.toString(),
        });
      }
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ products: result });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ message: "یک یا چند کالا پیدا نشد یا فعال نیست." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "PRICE_CONFLICT") {
      return NextResponse.json({ message: "قیمت کالا هم‌زمان تغییر کرده است؛ فهرست را تازه‌سازی کنید." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PRICE_OVERFLOW") {
      return NextResponse.json({ message: "قیمت جدید از محدوده مجاز سامانه بیشتر می‌شود." }, { status: 400 });
    }
    console.error("PATCH /api/products/prices/bulk:", error);
    return NextResponse.json({ message: "افزایش گروهی قیمت انجام نشد." }, { status: 500 });
  }
}
