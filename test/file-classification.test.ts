import { describe, expect, it } from "vitest";

import { isConfigFile, isTestFile } from "../src/file-classification.js";

describe("isTestFile", () => {
  describe("standard infix patterns", () => {
    it.each(["src/calc.test.ts", "src/calc.spec.ts", "src/calc_test.go", "src/calc_spec.rb"])("matches %s", (p) =>
      expect(isTestFile(p)).toBe(true));
  });

  describe("test directory patterns", () => {
    it.each([
      "test/calc.ts",
      "tests/todo_cli.rs",
      "__tests__/calc.js",
      "src/__tests__/helper.ts",
      "src\\__tests__\\helper.ts",
      "test/nested/deep.ts",
      "tests/integration/api.rs",
      "tests\\integration\\api.rs",
    ])("matches %s", (p) => expect(isTestFile(p)).toBe(true));
  });

  describe("Python test_ prefix", () => {
    it.each(["test_word_frequency.py", "tests/test_word_frequency.py", "src/test_calc.py"])("matches %s", (p) =>
      expect(isTestFile(p)).toBe(true));
  });

  describe("production files", () => {
    it.each([
      "src/calc.ts",
      "src/main.rs",
      "src/lib.rs",
      "src/word_frequency.py",
      "src/testing_utils.py",
      "src/contest.ts",
      "src/latest.go",
    ])("does not match %s", (p) => expect(isTestFile(p)).toBe(false));
  });
});

describe("isConfigFile", () => {
  it.each([
    "vitest.config.ts",
    "vite.config.mts",
    "app/jest.config.cjs",
    "frontend/playwright.config.ts",
    "frontend\\playwright.config.ts",
    "eslint.config.js",
    "package.json",
    "tsconfig.json",
    "Cargo.lock",
    "Gemfile",
    "mix.exs",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "phpunit.xml",
    "phpunit.xml.dist",
    "setup.py",
    "backend\\project.csproj",
    "backend\\solution.sln",
  ])("matches %s", (p) => expect(isConfigFile(p)).toBe(true));

  it.each(["src/index.ts", "src/app.config.ts", "src/vitest.helpers.ts"])("does not match %s", (p) =>
    expect(isConfigFile(p)).toBe(false));
});
