import type { FastifyReply, FastifyRequest } from "fastify";
import { makeId } from "./ids.js";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "USERNAME_TAKEN"
  | "INVALID_CREDENTIALS"
  | "TEAM_NOT_FOUND"
  | "BATTLE_NOT_FOUND"
  | "NPC_NOT_FOUND"
  | "HERO_DUPLICATED"
  | "HERO_NOT_OWNED"
  | "TEAM_VERSION_CONFLICT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function sendError(reply: FastifyReply, requestId: string, err: ApiError) {
  reply.status(err.status).send({
    error: {
      code: err.code,
      message: err.message,
      requestId
    }
  });
}

export function installErrorHandler(app: any) {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // attach requestId early
    (req as any).requestId = makeId("req");
    reply.header("x-request-id", (req as any).requestId);
  });

  app.setErrorHandler((err: any, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = (req as any).requestId ?? makeId("req");
    if (err instanceof ApiError) return sendError(reply, requestId, err);

    // Fastify validation errors
    if (err?.validation) {
      return sendError(reply, requestId, new ApiError(400, "VALIDATION_ERROR", "Validation error"));
    }

    req.log.error({ err, requestId }, "unhandled error");
    return sendError(reply, requestId, new ApiError(500, "INTERNAL_ERROR", "Internal error"));
  });
}

