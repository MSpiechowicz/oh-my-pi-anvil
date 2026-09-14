#!/usr/bin/env -S deno run --allow-all
import { runUpdate, type UpdateAction, UpdateError } from "./update.ts";

function usage(): never { console.error("Usage: anvil-update check|install [--profile PROFILE]"); process.exit(2); }
async function main(argv: string[]): Promise<number> { const action = argv[0]; if (action !== "check" && action !== "install") usage(); let profile: string | undefined; for (let index = 1; index < argv.length; index += 1) { if (argv[index] !== "--profile" || !argv[index + 1]) usage(); profile = argv[++index]; } try { console.log(JSON.stringify(await runUpdate(action as UpdateAction, profile))); return 0; } catch (error) { const message = error instanceof UpdateError || error instanceof Error ? error.message : String(error); console.error(`Update failed: ${message.replace(/[\u0000-\u001f\u007f]/g, " ")}`); return 1; } }
process.exit(await main(process.argv.slice(2)));
