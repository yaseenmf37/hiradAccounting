
import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth";

export async function POST() {
  try {
    await deleteCurrentSession();

    return NextResponse.json({
      success: true,
      message: "با موفقیت خارج شدید.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return NextResponse.json(
      { message: "خطا هنگام خروج از حساب." },
      { status: 500 }
    );
  }
}
