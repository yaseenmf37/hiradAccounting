import { readFileSync } from "node:fs";
import { config as loadDotEnv, parse as parseDotEnv } from "dotenv";

const developmentEnvPath = ".env.development.local";
const dotenvOptions = { quiet: true };

function readEnvFile(path) {
  try {
    return parseDotEnv(readFileSync(path));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function databaseIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    return JSON.stringify([
      url.protocol,
      url.hostname.toLowerCase(),
      url.port || "5432",
      url.pathname,
      decodeURIComponent(url.username),
    ]);
  } catch {
    return null;
  }
}

function projectReference(value) {
  try {
    const url = new URL(value);
    const directMatch = url.hostname.match(/^db\.([^.]+)\.supabase\.(?:co|com)$/i);
    if (directMatch) return directMatch[1].toLowerCase();
    const poolerMatch = decodeURIComponent(url.username).match(/^postgres\.([^.]+)$/i);
    return poolerMatch?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function configureDevelopmentDatabaseEnvironment({ forceDevelopment = false } = {}) {
  if (process.env.NODE_ENV === "production") {
    if (forceDevelopment) {
      throw new Error(
        "A development database check cannot run while NODE_ENV is production.",
      );
    }
    if (process.env.HIRAD_DATABASE_ENV !== "production") {
      throw new Error(
        "Production Prisma commands require HIRAD_DATABASE_ENV=production to be set explicitly.",
      );
    }
    loadDotEnv({ path: ".env", override: false, ...dotenvOptions });
    return;
  }
  if (
    process.env.HIRAD_DATABASE_ENV &&
    process.env.HIRAD_DATABASE_ENV !== "development"
  ) {
    throw new Error(
      "A development process cannot use a non-development HIRAD_DATABASE_ENV.",
    );
  }

  const development = readEnvFile(developmentEnvPath);
  if (!development) {
    throw new Error(
      `Missing ${developmentEnvPath}. Create it with a separate Supabase Development project's credentials before starting the development server or running Prisma commands.`,
    );
  }
  if (development.HIRAD_DATABASE_ENV !== "development") {
    throw new Error(
      `${developmentEnvPath} must contain HIRAD_DATABASE_ENV=development.`,
    );
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    if (!databaseIdentity(development[name])) {
      throw new Error(
        `${developmentEnvPath} must contain a valid PostgreSQL ${name}.`,
      );
    }
  }

  const base = readEnvFile(".env");
  if (base) {
    for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
      const currentIdentity = databaseIdentity(base[name]);
      if (currentIdentity && currentIdentity === databaseIdentity(development[name])) {
        throw new Error(
          `${name} in ${developmentEnvPath} resolves to the same database target as .env. Use a separate Supabase Development project.`,
        );
      }
    }
  }

  const runtimeProject = projectReference(development.DATABASE_URL);
  const directProject = projectReference(development.DIRECT_URL);
  if (runtimeProject && directProject && runtimeProject !== directProject) {
    throw new Error(
      `${developmentEnvPath} DATABASE_URL and DIRECT_URL refer to different Supabase projects.`,
    );
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const inheritedValue = process.env[name];
    if (inheritedValue && inheritedValue !== development[name]) {
      throw new Error(
        `The process ${name} does not match ${developmentEnvPath}; refusing to select an ambiguous database target.`,
      );
    }
    process.env[name] = development[name];
  }
  process.env.HIRAD_DATABASE_ENV = "development";

  loadDotEnv({ path: developmentEnvPath, override: true, ...dotenvOptions });
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/development-database-env.mjs")) {
  try {
    configureDevelopmentDatabaseEnvironment({ forceDevelopment: true });
    console.log("Development database configuration is valid; connection details were not printed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Development database configuration is invalid.");
    process.exitCode = 1;
  }
}
