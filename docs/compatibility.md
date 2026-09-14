# OMP compatibility

Anvil presents `/forge` as its workflow command and `/anvil` as its configuration, diagnostic, run-management, and update command. The extension keeps host-specific child execution behind a small compatibility adapter.

## OMP boundary

Anvil keeps OMP-specific child execution behind `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

Current OMP releases expose these capabilities through the SDK namespace on `ExtensionAPI.pi`. The adapter uses that namespace for agent discovery and structured subprocess execution, and uses the native `TaskTool` only when an isolated worktree is requested. Older hosts that expose the legacy context methods remain supported; hosts with neither boundary report a typed `OMP_EXECUTOR_UNAVAILABLE` failure instead of throwing during workflow setup.

The workflow engine never imports `ToolSession`, does not replay parent transcripts, and does not assume one provider or model family. When OMP changes task executor signatures, update the compatibility adapter rather than the state machine.

## Agent output contracts

Forge passes complete JSON Schema draft-07 contracts to both OMP subprocesses and isolated tasks. Architect, Smith, Sentinel, and Inquisitor each receive their role's schema from `src/schemas/outputs.ts`; Forge compiles those same schemas with Ajv for local validation. Required fields, nested types, enum values, and unknown fields are checked without coercion, defaults, or field removal. Errors identify the role and failing field path.

Smith's `needs_replan` result requires a nonempty `replanReason`. Both review gates require nonempty findings for a `findings` verdict and a nonempty `blockedReason` for `blocked`. A blocked Inquisitor result stops the run; it cannot seal a passing review gate. Architect's step IDs and dependency references are also checked locally after schema validation.

Warden does not produce an LLM report: its deterministic check results come directly from the process runner.

## Commands and storage names

Use the management command for setup and the Forge command for objectives:

```text
/anvil config
/anvil doctor
/anvil init
/anvil update check|install
/anvil status [run-id]
/anvil resume <run-id>
/anvil findings [run-id]
/anvil cancel <run-id>
/forge "Describe the change to make"
```

The canonical project overlay is `.omp/anvil.yml`. Runtime state is stored under `.omp/.anvil/`, separate from source revisions and command handling.
