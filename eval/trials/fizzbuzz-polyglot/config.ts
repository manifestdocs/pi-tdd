import type { ProjectConfig } from "../../types.js";

const config: ProjectConfig = {
  name: "fizzbuzz-polyglot",
  description: "FizzBuzz with configurable rules",
  prdFile: "PRD.md",
  taskCount: 3,
  scaffoldDir: "scaffold",
  plugin: "pi-tdd",
  features: ["test-command-detect", "makefile-detection", "phase-gating"],
  variants: {
    "c-tap": {
      stacks: { language: "C", testFramework: "TAP", setup: "Use a Makefile. Write tests that output TAP format." },
    },
    "typescript-vitest": {
      stacks: { language: "TypeScript", testFramework: "Vitest" },
    },
    "ruby-rspec": {
      stacks: { language: "Ruby", testFramework: "RSpec", setup: "Create a Gemfile." },
    },
  },
};

export default config;
