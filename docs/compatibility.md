# OMP compatibility

Anvil presents `/forge` as its workflow command and `/anvil` as its configuration, diagnostic, run-management, and update command. The extension keeps host-specific child execution behind a small compatibility adapter.

## OMP boundary

Anvil keeps OMP-specific child execution behind `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

Current OMP releases expose these capabilities through the SDK namespace on `ExtensionAPI.pi`. The adapter uses that namespace for agent discovery and structured subprocess execution, and uses the native `TaskTool` only when an isolated worktree is requested. Older hosts that expose the legacy context methods remain supported; hosts with neither boundary report a typed `OMP_EXECUTOR_UNAVAILABLE` failure instead of throwing during workflow setup.

The workflow engine never imports `ToolSession`, does not replay parent transcripts, and does not assume one provider or model family. When OMP changes task executor signatures, update the compatibility adapter rather than the state machine.

Bundled Sentinel and Inquisitor definitions include `bash`, `eval`, and `github`. The native adapter preserves these validation capabilities for the security/review roles while still filtering source-edit and spawn tools; Architect retains its narrow tool set. OMP 18.1.22 exposes browser automation as the `browser` prelude through `eval`, not a standalone `browser` tool. Reviewer child settings enable that prelude and disable inherited relay/CDP/cmux connections. `curl` and `gh` require their installed binaries; native `github` availability also depends on host support. Custom agent definitions must list the capabilities they want.

These are instruction-restricted inspection roles, not execution sandboxes. Shell, Eval, browser JavaScript, and GitHub operations can have side effects; reviewer instructions prohibit source changes and unauthorized remote writes, and Forge rejects changed repository revisions. That detection cannot undo external effects. Older direct executors own their tool/session setup rather than using the native adapter's filtering and browser defaults.

### Dashboard usage reporting

On native hosts exposing `sessionManager.appendModelUsage` (verified with OMP 18.2.0), Forge records each child assistant `message_end` usage event as a parent-session `model_usage` entry. Both subprocess and isolated TaskTool execution use this bridge. Entries preserve the request's actual provider, model, token/cache counters, and cost, including reported usage from failed or cancelled requests and requests before a model fallback. Aggregate task results are not recorded again.

Each entry also carries the logical Forge `role` and a top-level `thinkingLevel`. Thinking comes only from native per-agent progress whose `resolvedModelIdentity` matches the request's actual provider/model; concrete levels include `off`, while absent, invalid, or unresolved `auto` metadata is recorded as `null`. The bridge waits at most until the next raw event or a microtask so the host's synchronous serving-model update after a raw event can attribute that request correctly, including auto effort and fallback changes. It never changes the parent's thinking selector or model, and does not infer child thinking from configuration, model suffixes, or final task totals.

Native execution waits for any outstanding usage writes before settling. A synchronous writer exception or asynchronous rejection is reported through the adapter's normal execution-failure result, rather than escaping the deferred flush as an unhandled error or reporting success with failed persistence.

The usage dashboard consumes these standard session entries without a dashboard-specific API or database write from Forge. Entries are bound to the originating session and branch; late events cannot be charged to a different active session. Hosts without the native session writer retain Forge's run-local usage accounting only. This does not backfill historical runs or recover usage that the host never emitted.

## Agent output contracts

Forge passes complete JSON Schema draft-07 contracts to both OMP subprocesses and isolated tasks. Architect, Smith, Sentinel, Inquisitor, Scout, and Archivist each receive their role's schema from `src/schemas/outputs.ts`; Forge compiles those same schemas with Ajv for local validation. Required fields, nested types, enum values, and unknown fields are checked without coercion, defaults, or field removal. Errors identify the role and failing field path.

Smith's `needs_replan` result requires a nonempty `replanReason`. Both review gates require nonempty findings for a `findings` verdict and a nonempty `blockedReason` for `blocked`. A blocked Inquisitor result stops the run; it cannot seal a passing review gate. Architect's step IDs and dependency references are also checked locally after schema validation.

Warden does not produce an LLM report: its deterministic check results come directly from the process runner.

Optional Scout and Archivist invocations use the same persisted attempts, usage accounting, and strict output validation. Scout runs in PLAN before Architect; Archivist runs in REVIEW after all gates pass, before sealing. Neither is a gate. Invalid or unavailable advisory output is discarded; source mutation still fails Scout or forces all gates to rerun after Archivist. Their attempts do not consume Architect or Inquisitor attempt limits.

Architect's `requiredChecks` names configured Warden command IDs. Browser/manual verification stays in acceptance criteria. Smith can return `verification` entries containing `criterion`, `status` (`passed`, `failed`, or `not_run`), concrete `evidence`, and optional run-root-relative `artifactPaths`. Forge captures supporting files, verifies containment and hashes, and binds the report to the actual resulting revision and mutation epoch before handing it to reviewers. These remain Smith's claims, distinct from authoritative Warden results. Omitting verification is not a passing result.

Sentinel's optional `verificationIndependent` declaration defaults conservatively: absent/false means changed Smith verification invalidates reuse. `true` means its verdict relies on source and deterministic evidence without Smith verification claims. Reuse also requires an explicit `liveValidation: false`; true or an absent declaration cannot establish independence from live HTTP/GitHub/browser state. Reviewers must report live checks honestly; engine dependency checks do not establish whether remote state is unchanged.

## Per-agent execution summaries

Every settled agent invocation writes a runner-result summary under `<runtime-root>/runs/<run-id>/artifacts/<role>/output-<attempt-sequence>.json` (artifact kind `agent-output`, linked to its attempt). The default runtime root is `.anvil`; roles are `planner`, `implementation`, `security`, `review`, `scout`, and `archivist`. Sequence numbers are run-wide, not per-role. These summaries are separate from domain reports: plans use `artifacts/planner/plan-<sequence>.json`, reviewers use their role's `attempt-<sequence>.json`, optional specialists use `artifacts/<role>/result-<sequence>.json`, and revision-bound Smith manifests use `artifacts/implementation/<attempt-id>/result.json`.

The summary contains the runner status, usage, structured output when available, error when present, and these execution fields:

- `resolvedModel`: OMP's resolved model display string, which can include a thinking-level suffix. It is not the configured model pattern or the parent's model.
- `resolvedThinkingLevel`: OMP's explicit resolved thinking metadata, including values such as `off` or `auto` when reported. Forge does not infer it from model suffixes or settings.
- `durationMs`: total elapsed milliseconds measured with a monotonic clock around the complete agent-runner invocation, including adapter setup, isolation and executor cleanup. It excludes handoff preparation, summary persistence, later revision capture and gate processing. This same measured duration is saved on the attempt.

Unavailable model or thinking metadata is explicitly `null`, including older hosts and errors before resolution. Returned failures, cancellations, invalid structured results and thrown executor errors still get summaries before downstream revision or schema checks; a process killed before invocation settlement cannot write a completed summary. No historical artifacts are backfilled. Warden is not a model agent and retains its existing deterministic check artifacts and per-check `durationMs`.

New manifests bind Smith evidence to an attempt, actual result revision, and mutation epoch. Historical raw summaries remain available on disk but are not promoted into current verification or reusable gates without those bindings; missing historical proof is not backfilled or inferred.

The adapter contract was checked against OMP `18.1.22`'s `task/types.ts` (`SingleResult`) and `task/executor.ts`: subprocess results and isolated TaskTool `details.results[0]` expose `resolvedModel`, `resolvedThinkingLevel` and `durationMs`. The settled model metadata reflects OMP's last reported serving/resolved model, not a full history of model changes during a run. Missing native duration remains unknown at the adapter boundary; the workflow always measures the full invocation itself.

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

The canonical project overlay is `.omp/anvil.yml`. Runtime state is stored under `.anvil/`, separate from source revisions and command handling.
