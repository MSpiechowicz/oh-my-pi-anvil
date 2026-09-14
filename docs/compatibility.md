# OMP compatibility

Anvil keeps OMP-specific child execution behind `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

The extension factory only requires the public `ExtensionAPI` shape: a label setter and command registration. The host context is passed to the compatibility adapter so discovery and structured child execution can follow the installed OMP release.

The workflow engine never imports `ToolSession`, does not replay parent transcripts, and does not assume one provider or model family. When OMP changes task executor signatures, update the compatibility adapter rather than the state machine.
