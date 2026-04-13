import type { ProjectConfig } from "../../types.js";

const config: ProjectConfig = {
  name: "word-freq",
  description: "Word frequency counter library",
  prdFile: "PRD.md",
  taskCount: 3,
  plugin: "pi-tdd",
  features: ["test-command-detect", "phase-gating", "red-green-refactor"],
  variants: {
    "go-gotest": {
      stacks: { language: "Go", testFramework: "go test", setup: "Use table-driven tests. Create a go.mod." },
    },
    "python-pytest": {
      stacks: { language: "Python", testFramework: "pytest", setup: "Create a pyproject.toml." },
    },
    "typescript-vitest": {
      stacks: { language: "TypeScript", testFramework: "Vitest" },
    },
  },
};

export default config;
