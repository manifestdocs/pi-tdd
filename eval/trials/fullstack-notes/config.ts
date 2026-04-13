import type { ProjectConfig } from "../../types.js";

const config: ProjectConfig = {
  name: "fullstack-notes",
  description: "Notes app monorepo with API and shared validation library",
  prdFile: "PRD.md",
  taskCount: 3,
  scaffoldDir: "scaffold",
  plugin: "pi-tdd",
  features: ["monorepo-detection", "subdirectory-exec", "test-command-detect"],
  variants: {
    "typescript-vitest": {
      stacks: [
        { language: "TypeScript", testFramework: "Vitest", scope: "API" },
        { language: "TypeScript", testFramework: "Vitest", scope: "shared validation library" },
      ],
    },
    "typescript-jest": {
      stacks: [
        { language: "TypeScript", testFramework: "Jest", scope: "API" },
        { language: "TypeScript", testFramework: "Jest", scope: "shared validation library" },
      ],
    },
  },
};

export default config;
