import assert from "node:assert/strict";
import { describe, it as test } from "node:test";

export { describe, test };

export function expect<T>(value: T) {
  return {
    toBe(expected: unknown): void { assert.strictEqual(value, expected); },
    toEqual(expected: unknown): void { assert.deepStrictEqual(value, expected); },
    toContain(expected: unknown): void { assert.ok(typeof value === "string" && value.includes(String(expected))); },
    toHaveLength(expected: number): void { assert.strictEqual((value as { length: number }).length, expected); },
    toBeTruthy(): void { assert.ok(value); },
    toBeFalsy(): void { assert.ok(!value); },
    toBeGreaterThan(expected: number): void { assert.ok((value as number) > expected); },
    toBeLessThanOrEqual(expected: number): void { assert.ok((value as number) <= expected); },
    toThrow(expected?: unknown): void { if (expected) assert.throws(value as unknown as () => unknown, (error: unknown) => error instanceof Error && error.message.includes(String(expected))); else assert.throws(value as unknown as () => unknown); },
    rejects: { toThrow: async (expected?: unknown): Promise<void> => { if (expected) await assert.rejects(value as unknown as Promise<unknown>, (error: unknown) => error instanceof Error && error.message.includes(String(expected))); else await assert.rejects(value as unknown as Promise<unknown>); } },
  };
}
