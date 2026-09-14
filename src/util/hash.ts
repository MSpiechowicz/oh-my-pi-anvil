import { createHash } from "node:crypto";
import { stableJson } from "./json.ts";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256(stableJson(value));
}
