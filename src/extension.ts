import { createRuntime } from "./runtime.ts";
import { CommandRouter } from "./commands/router.ts";

export interface ExtensionContext { cwd: string; runtimeContext?: unknown; respond?: (message: string) => void | Promise<void>; [key: string]: unknown; }
export interface ExtensionAPI { setLabel?(label: string): void; registerCommand(name: string, definition: { description: string; handler: (args: string, context: ExtensionContext) => Promise<void> }): void; on?(event: string, handler: () => void | Promise<void>): void; }

export default function anvilExtension(pi: ExtensionAPI): void {
  pi.setLabel?.("Anvil · The Forge");
  const router = new CommandRouter(async (context) => createRuntime(context.cwd, context.runtimeContext ?? context));
  pi.registerCommand("orchestrate", { description: "Run and manage Anvil's stateful multi-agent Forge", handler: async (args, context) => { const input = args.trim().replace(/^\/orchestrate\s*/, ""); const output = await router.handle(input, { cwd: context.cwd, runtimeContext: context }); await context.respond?.(output); } });
}
