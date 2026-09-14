import { stableJson } from "./json.ts";

export function sha256(input: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256(stableJson(value));
}
