import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { configureDevelopmentDatabaseEnvironment } from "../scripts/development-database-env.mjs";

const originalDirectory = process.cwd();
const originalEnvironment = Object.fromEntries(
  ["NODE_ENV", "HIRAD_DATABASE_ENV", "DATABASE_URL", "DIRECT_URL"].map((key) => [
    key,
    process.env[key],
  ]),
);

function inTemporaryDirectory(callback, { development = true, sameTarget = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "hirad-db-env-"));
  const productionPooler = "postgresql://postgres.prodref:secret@aws-0-region.pooler.supabase.com:6543/postgres";
  const productionDirect = "postgresql://postgres:secret@db.prodref.supabase.co:5432/postgres";
  writeFileSync(
    path.join(directory, ".env"),
    `DATABASE_URL="${productionPooler}"\nDIRECT_URL="${productionDirect}"\n`,
  );
  if (development) {
    const developmentPooler = sameTarget
      ? productionPooler
      : "postgresql://postgres.devref:secret@aws-0-region.pooler.supabase.com:6543/postgres";
    const developmentDirect = sameTarget
      ? productionDirect
      : "postgresql://postgres:secret@db.devref.supabase.co:5432/postgres";
    writeFileSync(
      path.join(directory, ".env.development.local"),
      `HIRAD_DATABASE_ENV=development\nDATABASE_URL="${developmentPooler}"\nDIRECT_URL="${developmentDirect}"\n`,
    );
  }
  process.chdir(directory);
  try {
    return callback();
  } finally {
    process.chdir(originalDirectory);
    rmSync(directory, { recursive: true, force: true });
  }
}

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("development config selects separate local Supabase targets without printing them", () => {
  restoreEnvironment();
  inTemporaryDirectory(() => {
    configureDevelopmentDatabaseEnvironment();
    assert.equal(process.env.HIRAD_DATABASE_ENV, "development");
    assert.match(process.env.DATABASE_URL, /devref/);
    assert.match(process.env.DIRECT_URL, /devref/);
  });
  restoreEnvironment();
});

test("development config refuses missing local env and production-equivalent targets", () => {
  restoreEnvironment();
  inTemporaryDirectory(
    () => assert.throws(configureDevelopmentDatabaseEnvironment, /Missing \.env\.development\.local/),
    { development: false },
  );
  restoreEnvironment();
  inTemporaryDirectory(
    () => assert.throws(configureDevelopmentDatabaseEnvironment, /same database target as \.env/),
    { sameTarget: true },
  );
  restoreEnvironment();
});

test("production config does not require or load development credentials", () => {
  restoreEnvironment();
  process.env.NODE_ENV = "production";
  process.env.HIRAD_DATABASE_ENV = "production";
  inTemporaryDirectory(() => {
    configureDevelopmentDatabaseEnvironment();
    assert.equal(process.env.HIRAD_DATABASE_ENV, "production");
    assert.match(process.env.DATABASE_URL, /prodref/);
    assert.match(process.env.DIRECT_URL, /prodref/);
  }, { development: false });
  restoreEnvironment();
});

test("production Prisma config requires an explicit production marker", () => {
  restoreEnvironment();
  process.env.NODE_ENV = "production";
  assert.throws(
    () => configureDevelopmentDatabaseEnvironment(),
    /HIRAD_DATABASE_ENV=production/,
  );
  restoreEnvironment();
});
