import type { AgentRole } from "../workflow/types.ts";
const subjects: Record<AgentRole, string> = {
  planner: "Architect architecture conventions",
  implementation: "Smith implementation conventions and previous decisions",
  security: "Sentinel security invariants and threat model",
  review: "Inquisitor review conventions and architectural constraints",
  scout: "Scout repository structure and investigation areas",
  archivist: "Archivist durable project conventions and successful decisions",
};

export function memoryQuery(role: AgentRole, summary: string): string { return `${subjects[role]} relevant to: ${summary}`; }
