
import { defineConfig, env } from "prisma/config";
import { configureDevelopmentDatabaseEnvironment } from "./scripts/development-database-env.mjs";

configureDevelopmentDatabaseEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
