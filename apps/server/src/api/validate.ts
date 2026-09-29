import type { z } from "zod";
import { HubError } from "../services/errors.js";

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new HubError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed.",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
