import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("127.0.0.1"),
  JWT_SECRET: z.string().min(16).default("dev-only-change-me-please"),
  DB_PATH: z.string().default("data/app.db"),
  CORS_ORIGIN: z.string().default("*"),
  CONTENT_DIR: z.string().default("apps/api/content")
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid env:\n${msg}`);
  }
  return parsed.data;
}
