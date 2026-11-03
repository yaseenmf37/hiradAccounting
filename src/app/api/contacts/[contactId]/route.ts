import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ contactId: string }>;
};

async function authorize() {
  const user = await getCurrentUser();

  if (!user || user.role !== "BUSINESS_OWNER" || !user.business?.isActive) {
    return {
      response: NextResponse.json(
        { message: "دسترسی غیرمجاز است." },
        { status: 401 }
      ),
      businessId: null,
    };
  }

  return {
    response: null,
    businessId: user.business.id,
  };
}

const updateContactSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(150).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "حداقل یک فیلد برای ویرایش لازم است.",
});

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { contactId } = await params;

    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        businessId: auth.businessId!,
      },
      include: {
        _count: {
          select: {
            invoices: true,
            payments: true,
          },
        },
      },
    });

    if (!contact) {
      return NextResponse.json(
        { message: "مخاطب پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({ contact });
  } catch (error) {
    console.error("GET /api/contacts/[contactId]:", error);

    return NextResponse.json(
      { message: "دریافت اطلاعات مخاطب انجام نشد." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { contactId } = await params;
    const body = await request.json();
    const validation = updateContactSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات واردشده معتبر نیست.",
          errors: validation.error.flatten(),
        },
        { status: 400 }
      );
    }

    const existing = await prisma.contact.findFirst({
      where: {
        id: contactId,
        businessId: auth.businessId!,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { message: "مخاطب پیدا نشد." },
        { status: 404 }
      );
    }

    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: validation.data,
    });

    return NextResponse.json({
      message: "اطلاعات مخاطب به‌روزرسانی شد.",
      contact,
    });
  } catch (error) {
    console.error("PATCH /api/contacts/[contactId]:", error);

    return NextResponse.json(
      { message: "ویرایش مخاطب انجام نشد." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const { contactId } = await params;

    const result = await prisma.contact.updateMany({
      where: {
        id: contactId,
        businessId: auth.businessId!,
      },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { message: "مخاطب پیدا نشد." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "مخاطب با موفقیت آرشیو شد.",
    });
  } catch (error) {
    console.error("DELETE /api/contacts/[contactId]:", error);

    return NextResponse.json(
      { message: "آرشیو مخاطب انجام نشد." },
      { status: 500 }
    );
  }
}