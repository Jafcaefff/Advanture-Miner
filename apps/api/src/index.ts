import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";

import { loadEnv } from "./env.js";
import { openDb, migrate } from "./db.js";
import { seedContent } from "./content.js";
import { installErrorHandler } from "./http-errors.js";
import { installRoutes } from "./routes.js";

const env = loadEnv();

const app = Fastify({
  logger: true
});

installErrorHandler(app);

await app.register(cors, {
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim())
});

await app.register(jwt, {
  secret: env.JWT_SECRET
});

app.addHook("preHandler", async (req) => {
  // Attach req.user for authenticated requests; routes call requireAuth as needed.
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return;
  try {
    const payload = await req.jwtVerify<{ userId: string }>();
    (req as any).user = { userId: payload.userId };
  } catch {
    // ignore here; route will throw UNAUTHORIZED if it requires auth
  }
});

const db = openDb(env.DB_PATH);
migrate(db);
seedContent(db);

installRoutes(app, db);

await app.listen({ port: env.PORT, host: env.HOST });
