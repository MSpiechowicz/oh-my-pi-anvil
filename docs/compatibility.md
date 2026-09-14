# OMP compatibility

Anvil presents `/forge` as its workflow command and `/anvil` as its configuration, diagnostic, run-management, and update command. The extension keeps host-specific child execution behind a small compatibility adapter.

## OMP boundary

Anvil keeps OMP-specific child execution behind `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

The extension factory only requires the public `ExtensionAPI` shape: a label setter and command registration. The host context is passed to the compatibility adapter so discovery and structured child execution can follow the installed OMP release.

The workflow engine never imports `ToolSession`, does not replay parent transcripts, and does not assume one provider or model family. When OMP changes task executor signatures, update the compatibility adapter rather than the state machine.

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
