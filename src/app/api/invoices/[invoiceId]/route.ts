
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toRial } from "@/lib/currency";

type RouteContext = {
  params: Promise<{ invoiceId: string }>;
};

const amountSchema = z.string().regex(/^\d{1,18}$/);

const invoiceSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"]),
  contactId: z.string().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  extraCosts: amountSchema.default("0"),
  discount: amountSchema.default("0"),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/),
      unitPrice: amountSchema,
    })
  ).min(1).max(100),
});

function authorize(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) {
    return {
      error: NextResponse.json(
        { message: "لطفاً وارد حساب کاربری شوید." },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      error: NextResponse.json(
        { message: "دسترسی به این بخش مجاز نیست." },
        { status: 403 }
      ),
    };
  }

  return { businessId: user.business.id };
}


function serializeInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  subtotal: bigint;
  extraCosts: bigint;
  discount: bigint;
  total: bigint;
  description: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  contact: { id: string; name: string } | null;
  items: {
    id: string;
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: bigint;
    total: bigint;
    costOfGoodsSold: bigint;
    product: { name: string; unit: string };
  }[];
}) {
  return {
    ...invoice,
    subtotal: invoice.subtotal.toString(),
    extraCosts: invoice.extraCosts.toString(),
    discount: invoice.discount.toString(),
    total: invoice.total.toString(),
    items: invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: item.total.toString(),
      costOfGoodsSold: item.costOfGoodsSold.toString(),
    })),
  };
}


// مشاهده جزئیات فاکتور
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        businessId: auth.businessId,
      },
      include: {
        contact: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            product: {
              select: { name: true, unit: true },
            },
          },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { message: "فاکتور پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      invoice: serializeInvoice(invoice),
    });
  } catch (error) {
    console.error("Get invoice error:", error);

    return NextResponse.json(
      { message: "خطا در دریافت اطلاعات فاکتور." },
      { status: 500 }
    );
  }
}

// ویرایش پیش‌نویس
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const body = await request.json();
    const validation = invoiceSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات فاکتور معتبر نیست.",
          errors: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = validation.data;
    const businessId = auth.businessId;

    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          businessId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!existing) {
        throw new Error("INVOICE_NOT_FOUND");
      }

      if (existing.status !== "DRAFT") {
        throw new Error("INVOICE_NOT_EDITABLE");
      }

      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { currencyUnit: true },
      });

      if (!business) {
        throw new Error("BUSINESS_NOT_FOUND");
      }

      const productIds = [
        ...new Set(data.items.map((item) => item.productId)),
      ];

      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          businessId,
          isActive: true,
        },
        select: { id: true },
      });

      if (products.length !== productIds.length) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      if (data.contactId) {
        const contact = await tx.contact.findFirst({
          where: {
            id: data.contactId,
            businessId,
            isActive: true,
            ...(data.type === "SALE"
              ? { type: { in: ["CUSTOMER", "BOTH"] } }
              : { type: { in: ["SUPPLIER", "BOTH"] } }),
          },
          select: { id: true },
        });

        if (!contact) {
          throw new Error("CONTACT_NOT_FOUND");
        }
      }

      const extraCosts = toRial(
        BigInt(data.extraCosts),
        business.currencyUnit
      );

      const discount = toRial(
        BigInt(data.discount),
        business.currencyUnit
      );

      const items = data.items.map((item) => {
        const quantity = new Prisma.Decimal(item.quantity);

        if (quantity.lessThanOrEqualTo(0)) {
          throw new Error("INVALID_QUANTITY");
        }

        const unitPrice = toRial(
          BigInt(item.unitPrice),
          business.currencyUnit
        );

        const total = BigInt(
          quantity
            .mul(unitPrice.toString())
            .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(0)
        );

        return {
          productId: item.productId,
          quantity,
          unitPrice,
          total,
        };
      });

      const subtotal = items.reduce(
        (sum, item) => sum + item.total,
        BigInt(0)
      );

      if (discount > subtotal + extraCosts) {
        throw new Error("INVALID_DISCOUNT");
      }

      const total = subtotal + extraCosts - discount;

      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          type: data.type,
          contactId: data.contactId || null,
          description: data.description || null,
          subtotal,
          extraCosts,
          discount,
          total,
          items: {
            deleteMany: {},
            create: items,
          },
        },
        include: {
          contact: {
            select: { id: true, name: true },
          },
          items: {
            include: {
              product: {
                select: { name: true, unit: true },
              },
            },
          },
        },
      });
    });

    return NextResponse.json({
      message: "پیش‌نویس با موفقیت ویرایش شد.",
      invoice: serializeInvoice(invoice),
    });
  } catch (error) {
    if (error instanceof Error) {
      const messages: Record<string, { message: string; status: number }> = {
        INVOICE_NOT_FOUND: {
          message: "فاکتور پیدا نشد.",
          status: 404,
        },
        INVOICE_NOT_EDITABLE: {
          message: "فقط پیش‌نویس قابل ویرایش است.",
          status: 409,
        },
        BUSINESS_NOT_FOUND: {
          message: "کسب‌وکار پیدا نشد.",
          status: 404,
        },
        PRODUCT_NOT_FOUND: {
          message: "یک یا چند کالا معتبر نیستند.",
          status: 400,
        },
        CONTACT_NOT_FOUND: {
          message: "طرف حساب انتخاب‌شده معتبر نیست.",
          status: 400,
        },
        INVALID_QUANTITY: {
          message: "تعداد کالا باید بیشتر از صفر باشد.",
          status: 400,
        },
        INVALID_DISCOUNT: {
          message: "تخفیف نمی‌تواند از مجموع مبلغ فاکتور بیشتر باشد.",
          status: 400,
        },
      };

      const knownError = messages[error.message];

      if (knownError) {
        return NextResponse.json(
          { message: knownError.message },
          { status: knownError.status }
        );
      }
    }

    console.error("Update invoice error:", error);

    return NextResponse.json(
      { message: "خطا در ویرایش پیش‌نویس." },
      { status: 500 }
    );
  }
}

// حذف پیش‌نویس
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const user = await getCurrentUser();
    const auth = authorize(user);

    if ("error" in auth) return auth.error;

    const { invoiceId } = await context.params;

    const result = await prisma.invoice.deleteMany({
      where: {
        id: invoiceId,
        businessId: auth.businessId,
        status: "DRAFT",
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        {
          message: "فاکتور پیدا نشد یا امکان حذف آن وجود ندارد.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "پیش‌نویس با موفقیت حذف شد.",
    });
  } catch (error) {
    console.error("Delete invoice error:", error);

    return NextResponse.json(
      { message: "خطا در حذف پیش‌نویس." },
      { status: 500 }
    );
  }
}
