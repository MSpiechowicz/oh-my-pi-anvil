declare const Bun: {
  file(path: string): { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; exists(): Promise<boolean> };
  write(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number>;
  spawnSync(options: { cmd: string[]; cwd?: string; stdout?: "pipe" | "inherit"; stderr?: "pipe" | "inherit"; env?: Record<string, string> }): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array };
  spawn(options: { cmd: string[]; cwd?: string; stdout?: "pipe" | "inherit"; stderr?: "pipe" | "inherit"; env?: Record<string, string> }): { exited: Promise<number>; stdin: { write(data: string | Uint8Array): Promise<number>; end(): void }; stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; kill(signal?: number): void };
  CryptoHasher: new (algorithm: string) => { update(data: string | Uint8Array): void; digest(encoding: "hex" | "base64"): string };
};

declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { create?: boolean; readwrite?: boolean; strict?: boolean });
    exec(sql: string): void;
    run(sql: string, params?: unknown[] | Record<string, unknown>): { changes: number; lastInsertRowid: number };
    query<T = Record<string, unknown>>(sql: string): {
      get(...params: unknown[]): T | null;
      all(...params: unknown[]): T[];
      run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    };
    close(): void;
  }
}

declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T>(value: T): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toThrow(expected?: unknown): void;
    rejects: { toThrow(expected?: unknown): Promise<void> };
  };
}
