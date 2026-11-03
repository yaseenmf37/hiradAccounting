
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/prisma";

const rl = createInterface({ input: stdin, output: stdout });

async function main() {
  try {
    const username = (
      await rl.question("Admin username: ")
    ).trim();

    const fullName = (
      await rl.question("Admin full name: ")
    ).trim();

    const password = await rl.question("Admin password: ");

    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      throw new Error(
        "Username must be 3-40 characters: letters, numbers, _, . or -"
      );
    }

    if (!fullName || fullName.length > 100) {
      throw new Error("Invalid full name.");
    }

    if (password.length < 12 || password.length > 200) {
      throw new Error("Password must be between 12 and 200 characters.");
    }

    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      throw new Error("This username already exists.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        username,
        fullName,
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
        mustChangePassword: false,
      },
    });

    console.log("\nSuper Admin created successfully.");
    console.log(`Username: ${username}`);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nError:", error.message);
  process.exitCode = 1;
});
