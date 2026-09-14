# OMP compatibility

Anvil presents `/forge` as its primary OMP command. `/orchestrate` remains an equivalent compatibility alias for existing scripts and integrations; both names use the same workflow engine and state.

## OMP boundary

Anvil keeps OMP-specific child execution behind `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

The extension factory only requires the public `ExtensionAPI` shape: a label setter and command registration. The host context is passed to the compatibility adapter so discovery and structured child execution can follow the installed OMP release.

The workflow engine never imports `ToolSession`, does not replay parent transcripts, and does not assume one provider or model family. When OMP changes task executor signatures, update the compatibility adapter rather than the state machine.

## Commands and storage names

Use `/forge` in new commands and documentation:

```text
/forge doctor
/forge start "Describe the change to make"
/forge status [run-id]
```

The `/orchestrate` spelling is supported only as the equivalent compatibility alias. Internal runtime paths such as `.omp/orchestrator.yml` and `.omp/.orchestrator/` retain their historical names and are unrelated to which command spelling is used.
