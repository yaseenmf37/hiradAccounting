
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "accounting_session";
export const SESSION_DURATION = 7 * 24 * 60 * 60;

export function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  const expiresAt = new Date(
    Date.now() + SESSION_DURATION * 1000
  );

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
          business: {
            select: {
              id: true,
              name: true,
              isActive: true,
              currencyUnit: true,
            },
          },
        },
      },
    },
  });

  if (!session) return null;

  const invalid =
    session.expiresAt <= new Date() ||
    !session.user.isActive ||
    (
      session.user.role === "BUSINESS_OWNER" &&
      (!session.user.business || !session.user.business.isActive)
    );

  if (invalid) {
    await prisma.session.deleteMany({
      where: { tokenHash },
    });

    return null;
  }

  return session.user;
}

export async function deleteCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(token),
      },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}
