import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContactType, Prisma } from "@prisma/client";
import {
  getCursorPage,
  parseCursorPageParams,
} from "@/lib/cursor-pagination";

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

const contactSchema = z.object({
  name: z.string().trim().min(2).max(150),
  type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]).default("BOTH"),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(150).optional().nullable(),
  address: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search")?.trim() ?? "";
    const type = searchParams.get("type");
    const status = searchParams.get("status") ?? "active";
    const pagination = parseCursorPageParams(searchParams);

    if (!pagination) {
      return NextResponse.json(
        { message: "محدوده صفحه‌بندی معتبر نیست." },
        { status: 400 }
      );
    }

    const validTypes = ["CUSTOMER", "SUPPLIER", "BOTH"];

    if (type && type !== "ALL" && !validTypes.includes(type)) {
      return NextResponse.json(
        { message: "نوع مخاطب نامعتبر است." },
        { status: 400 }
      );
    }

    const baseWhere: Prisma.ContactWhereInput = {
        businessId: auth.businessId!,
        ...(type && type !== "ALL"
          ? {
              type:
                type === "CUSTOMER" || type === "SUPPLIER"
                  ? { in: [type as ContactType, ContactType.BOTH] }
                  : (type as ContactType),
            }
          : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
    const where: Prisma.ContactWhereInput = {
      ...baseWhere,
      ...(status === "all" ? {} : { isActive: true }),
    };

    const [rows, total, groupedContacts] = await prisma.$transaction([
      prisma.contact.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
        ...(pagination.cursor
          ? { cursor: { id: pagination.cursor }, skip: 1 }
          : {}),
        include: {
          _count: {
            select: {
              invoices: true,
              payments: true,
            },
          },
        },
      }),
      prisma.contact.count({ where }),
      prisma.contact.groupBy({
        by: ["type", "isActive"] as const,
        where: baseWhere,
        orderBy: [{ type: "asc" }, { isActive: "asc" }],
        _count: { _all: true },
      }),
    ]);
    const page = getCursorPage(rows, pagination.limit    );
    const stats = groupedContacts.reduce(
      (result, group) => {
        const count =
          typeof group._count === "object" && group._count
            ? group._count._all ?? 0
            : 0;
        if (group.isActive) result.active += count;
        if (status === "all" || group.isActive) {
          if (group.type === ContactType.CUSTOMER || group.type === ContactType.BOTH) {
            result.customers += count;
          }
          if (group.type === ContactType.SUPPLIER || group.type === ContactType.BOTH) {
            result.suppliers += count;
          }
        }
        return result;
      },
      { active: 0, customers: 0, suppliers: 0 },
    );

    return NextResponse.json({
      contacts: page.items,
      total,
      nextCursor: page.nextCursor,
      stats,
    });
  } catch (error) {
    console.error("GET /api/contacts:", error);

    return NextResponse.json(
      { message: "دریافت مخاطبین انجام نشد." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize();

    if (auth.response) return auth.response;

    const body = await request.json();
    const validation = contactSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          message: "اطلاعات واردشده معتبر نیست.",
          errors: validation.error.flatten(),
        },
        { status: 400 }
      );
    }

    const data = validation.data;

    const contact = await prisma.contact.create({
      data: {
        businessId: auth.businessId!,
        name: data.name,
        type: data.type,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        description: data.description || null,
      },
    });

    return NextResponse.json(
      {
        message: "مخاطب با موفقیت ثبت شد.",
        contact,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/contacts:", error);

    return NextResponse.json(
      { message: "ثبت مخاطب انجام نشد." },
      { status: 500 }
    );
  }
}