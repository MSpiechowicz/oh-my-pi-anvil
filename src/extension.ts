import { createRuntime } from "./runtime.ts";
import { CommandRouter } from "./commands/router.ts";
import { ensureGlobalConfig } from "./config/init.ts";
import { checkUpdate } from "./update.ts";

export interface ExtensionUI {
  notify?: (message: string, level?: string) => unknown;
  setStatus?: (key: string, text: string | undefined) => unknown;
  select?: (title: string, options: string[]) => Promise<string | undefined>;
  input?: (prompt: string, defaultValue?: string) => Promise<string | undefined>;
}

const UPDATE_STATUS_KEY = "anvil-update";

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

async function selectAnvilCommand(args: string, context: ExtensionContext): Promise<string | undefined> {
  let input = args.trim().replace(/^\/anvil\s*/, "");
  if (input === "help" || context.hasUI === false || typeof context.ui?.select !== "function") return input;
  if (!input) {
    const section = await context.ui.select("Anvil", ["Configuration", "Initialize", "Doctor", "Run management", "Update"]);
    if (!section) return undefined;
    if (section === "Configuration") return "config";
    if (section === "Initialize") return "init";
    if (section === "Doctor") return "doctor";
    if (section === "Run management") input = "runs";
    else input = "update";
  }
  if (input === "runs") {
    const action = await context.ui.select("Anvil / Run management", ["Status", "Resume", "Cancel", "Findings"]);
    if (!action) return undefined;
    if (action === "Status") return "status";
    if (action === "Findings") return "findings";
    if (typeof context.ui.input !== "function") return undefined;
    const runId = await context.ui.input(`Run ID to ${action.toLowerCase()}`, "run_");
    if (!runId?.trim()) return undefined;
    return `${action.toLowerCase()} ${runId.trim()}`;
  }
  if (input === "update") {
    const action = await context.ui.select("Anvil / Update", ["Check", "Install"]);
    if (!action) return undefined;
    if (action === "Check") return "update check";
    if (action === "Install") return "update install";
  }
  return input;
}

export default function anvilExtension(pi: ExtensionAPI): void {
  pi.setLabel?.("Anvil · The Forge");
  const router = new CommandRouter(async (context) => createRuntime(context.cwd, context.runtimeContext ?? context));
  const notifyOutput = async (context: ExtensionContext, output: string): Promise<void> => {
    if (context.ui?.notify) await context.ui.notify(output, "info");
    else await context.respond?.(output);
  };
  const forgeHandler = async (args: string, context: ExtensionContext): Promise<void> => {
    const input = args.trim().replace(/^\/forge\s*/, "");
    await notifyOutput(context, await router.handle(input, { cwd: context.cwd, runtimeContext: context }));
  };
  const anvilHandler = async (args: string, context: ExtensionContext): Promise<void> => {
    const input = await selectAnvilCommand(args, context);
    if (input === undefined) return;
    if (input === "update check" || input === "update install") {
      await context.ui?.setStatus?.(UPDATE_STATUS_KEY, undefined);
    }
    await notifyOutput(context, await router.handleAdmin(input, { cwd: context.cwd, runtimeContext: context }));
  };
  pi.registerCommand("anvil", { description: "Inspect Anvil configuration and manage updates", handler: anvilHandler });
  pi.registerCommand("forge", { description: "Run Anvil's bounded multi-agent workflow", handler: forgeHandler });
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
      const message = report.updateAvailable && report.managed
        ? "Anvil update available. Run `/anvil update install` to update it."
        : undefined;
      if (typeof context.ui?.setStatus === "function") {
        await context.ui.setStatus(UPDATE_STATUS_KEY, message);
      } else if (message) {
        await notify(context, message, "warning");
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
          `Anvil is installed. Created the global configuration at ${report.path}. Edit this file, then run /anvil doctor. In a repository, run /anvil init to create the project overlay.`,
          "info",
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await notify(
        context,
        `Anvil could not create its global configuration: ${detail}. Check the configuration directory permissions and run /anvil init after fixing them.`,
        "warning",
      );
    }
    if (context.hasUI !== false) context.setTimeout?.(() => checkForUpdate(context), 0);
  });
}
