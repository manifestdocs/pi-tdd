import type { ProjectConfig } from "../../types.js";

const config: ProjectConfig = {
  name: "todo-cli",
  description: "CLI todo manager with JSON persistence",
  prdFile: "PRD.md",
  taskCount: 3,
  plugin: "pi-tdd",
  features: ["test-command-detect", "phase-gating", "red-green-refactor"],
  variants: {
    "rust-cargo": {
      stacks: { language: "Rust", testFramework: "cargo test" },
    },
    "go-gotest": {
      stacks: { language: "Go", testFramework: "go test", setup: "Create a go.mod." },
    },
    "typescript-vitest": {
      stacks: { language: "TypeScript", testFramework: "Vitest" },
    },
  },
};

export default config;
