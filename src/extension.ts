import { createRuntime } from "./runtime.ts";
import { CommandRouter } from "./commands/router.ts";
import { ensureGlobalConfig } from "./config/init.ts";
import { checkUpdate } from "./update.ts";
export interface ExtensionUI {
  notify?: (message: string, level?: string) => unknown;
}
export interface ExtensionContext {
  cwd: string;
  runtimeContext?: unknown;
  hasUI?: boolean;
  setTimeout?: (callback: () => void, delay?: number) => unknown;
  ui?: ExtensionUI;
  respond?: (message: string) => void | Promise<void>;
  [key: string]: unknown;
}
export interface ExtensionAPI {
  setLabel?(label: string): void;
  registerCommand(
    name: string,
    definition: { description: string; handler: (args: string, context: ExtensionContext) => Promise<void> },
  ): void;
  on?(event: string, handler: (event: unknown, context: ExtensionContext) => void | Promise<void>): void;
}

export default function anvilExtension(pi: ExtensionAPI): void {
  pi.setLabel?.("Anvil · The Forge");
  const router = new CommandRouter(async (context) => createRuntime(context.cwd, context.runtimeContext ?? context));
  const handler = async (args: string, context: ExtensionContext): Promise<void> => {
    const input = args.trim().replace(/^\/(?:forge|orchestrate)\s*/, "");
    const output = await router.handle(input, { cwd: context.cwd, runtimeContext: context });
    if (context.ui?.notify) await context.ui.notify(output, "info");
    else await context.respond?.(output);
  };
  pi.registerCommand("forge", { description: "Run and manage Anvil's stateful multi-agent Forge", handler });
  pi.registerCommand("orchestrate", { description: "Compatibility alias for /forge", handler });
  const notify = async (context: ExtensionContext, message: string, level: string): Promise<void> => {
    try {
      if (context.ui?.notify) await context.ui.notify(message, level);
      else await context.respond?.(message);
    } catch {
      // Startup notifications must never prevent OMP from opening.
    }
  };
  const checkForUpdate = async (context: ExtensionContext): Promise<void> => {
    try {
      const report = await checkUpdate(process.env.OMP_PROFILE ?? process.env.PI_PROFILE, context.cwd);
      if (report.updateAvailable && report.managed) {
        await notify(context, "Anvil update available. Run `/forge update install` to update it.", "warning");
      }
    } catch {
      // Background startup update checks are best effort and remain quiet.
    }
  };

  pi.on?.("session_start", async (_event, context) => {
    try {
      const report = await ensureGlobalConfig();
      if (report.status === "created") {
        await notify(
          context,
          `Anvil is installed. Created the global configuration at ${report.path}. Edit this file, then run /forge doctor. In a repository, run /forge init to create the project overlay.`,
          "info",
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await notify(
        context,
        `Anvil could not create its global configuration: ${detail}. Check the configuration directory permissions and run /forge init after fixing them.`,
        "warning",
      );
    }
    if (context.hasUI !== false) context.setTimeout?.(() => checkForUpdate(context), 0);
  });
}
