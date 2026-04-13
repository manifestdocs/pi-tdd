import type { ProjectConfig } from "../../types.js";

const config: ProjectConfig = {
  name: "stack-calc",
  description: "Stack-based calculator library",
  prdFile: "PRD.md",
  taskCount: 3,
  plugin: "pi-tdd",
  features: ["test-command-detect", "phase-gating", "red-green-refactor"],
  variants: {
    "typescript-vitest": {
      stacks: { language: "TypeScript", testFramework: "Vitest" },
    },
    "typescript-jest": {
      stacks: { language: "TypeScript", testFramework: "Jest" },
    },
    "python-pytest": {
      stacks: { language: "Python", testFramework: "pytest", setup: "Create a pyproject.toml." },
    },
    "python-unittest": {
      stacks: { language: "Python", testFramework: "unittest", setup: "Create a pyproject.toml." },
    },
    "go-gotest": {
      stacks: { language: "Go", testFramework: "go test", setup: "Create a go.mod." },
    },
  },
};

export default config;
