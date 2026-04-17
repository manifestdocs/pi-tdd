import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { EvalSession, PluginEvent, VerifyResult } from "pi-do-eval";
import { describe, expect, it } from "vitest";
import plugin, { configure, scoreCorrectness, scoreInfrastructure, scoreTddCompliance } from "../plugins/pi-tdd.js";

// -- Helpers ------------------------------------------------------------------

function makeSession(overrides: Partial<EvalSession> = {}): EvalSession {
  return {
    toolCalls: [],
    fileWrites: [],
    pluginEvents: [],
    rawLines: [],
    startTime: 1000,
    endTime: 10000,
    exitCode: 0,
    tokenUsage: { input: 0, output: 0 },
    parseWarnings: 0,
    ...overrides,
  };
}

function makeVerify(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    passed: true,
    output: "ok",
    metrics: { testFileCount: 2, productionFileCount: 3 },
    ...overrides,
  };
}

function phaseChange(timestamp: number, from: string, to: string, trigger = "auto"): PluginEvent {
  return { timestamp, type: "phase_change", data: { from, to, trigger } };
}

function testRun(timestamp: number, passed: boolean): PluginEvent {
  return { timestamp, type: "test_run", data: { passed, command: "auto" } };
}

// -- scoreTddCompliance -------------------------------------------------------

describe("scoreTddCompliance", () => {
  it("returns 0 with empty session and notes missing tdd_start", () => {
    const { score, findings } = scoreTddCompliance(makeSession(), 3);
    // No tdd_start, no tdd_done, no file writes, no phase changes, no test runs
    // Only the specifying gate gives 20 (no prod writes during specifying = pass)
    expect(score).toBe(20);
    expect(findings).toContain("Agent never called tdd_start");
  });

  it("scores tdd_start success (+15)", () => {
    const session = makeSession({
      toolCalls: [{ timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "TDD enabled", wasBlocked: false }],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 15 (tdd_start) + 20 (no spec prod writes)
    expect(score).toBe(35);
  });

  it("scores tdd_start failure as finding", () => {
    const session = makeSession({
      toolCalls: [
        { timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "Could not detect", wasBlocked: false },
      ],
    });
    const { findings } = scoreTddCompliance(session, 3);
    expect(findings.some((f) => f.includes("tdd_start failed"))).toBe(true);
  });

  it("scores tdd_done (+5)", () => {
    const session = makeSession({
      toolCalls: [{ timestamp: 9000, name: "tdd_done", arguments: {}, resultText: "TDD disabled", wasBlocked: false }],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 5 (tdd_done) + 20 (no spec prod writes)
    expect(score).toBe(25);
  });

  it("scores test-before-production (+25)", () => {
    const session = makeSession({
      fileWrites: [
        { timestamp: 2000, path: "calc.test.ts", tool: "write", labels: ["test"] },
        { timestamp: 3000, path: "calc.ts", tool: "write", labels: ["production"] },
      ],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 25 (test first) + 20 (no spec prod writes)
    expect(score).toBe(45);
  });

  it("does not award test-first when production written first", () => {
    const session = makeSession({
      fileWrites: [
        { timestamp: 2000, path: "calc.ts", tool: "write", labels: ["production"] },
        { timestamp: 3000, path: "calc.test.ts", tool: "write", labels: ["test"] },
      ],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 0 (test first) + 20 (no spec prod writes — no specifying phases)
    expect(score).toBe(20);
  });

  it("penalizes production writes during specifying phase", () => {
    const session = makeSession({
      pluginEvents: [phaseChange(1000, "off", "specifying"), phaseChange(5000, "specifying", "implementing")],
      fileWrites: [
        { timestamp: 2000, path: "calc.ts", tool: "write", labels: ["production"] },
        { timestamp: 3000, path: "calc2.ts", tool: "write", labels: ["production"] },
      ],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 2 prod writes during specifying => 20 - 2*5 = 10, plus 1 implementing cycle => round(1/3*10) = 3
    expect(score).toBe(13);
  });

  it("does not penalize a production write that lands exactly on the specifying exit boundary", () => {
    const session = makeSession({
      pluginEvents: [phaseChange(1000, "off", "specifying"), phaseChange(5000, "specifying", "implementing")],
      fileWrites: [{ timestamp: 5000, path: "calc.ts", tool: "write", labels: ["production"] }],
    });
    const { score } = scoreTddCompliance(session, 3);
    // Boundary write should be treated as implementing, not specifying.
    expect(score).toBe(23);
  });

  it("caps specifying penalty at 0", () => {
    const writes = Array.from({ length: 10 }, (_, i) => ({
      timestamp: 2000 + i * 100,
      path: `file${i}.ts`,
      tool: "write" as const,
      labels: ["production"],
    }));
    const session = makeSession({
      pluginEvents: [phaseChange(1000, "off", "specifying")],
      fileWrites: writes,
    });
    const { score } = scoreTddCompliance(session, 3);
    // 10 prod writes => Math.max(0, 20 - 50) = 0
    expect(score).toBe(0);
  });

  it("scores red-green ordering (+25)", () => {
    const session = makeSession({
      pluginEvents: [testRun(2000, false), testRun(3000, true)],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 25 (red-green) + 20 (no spec prod writes)
    expect(score).toBe(45);
  });

  it("scores cycle count matching taskCount (+10)", () => {
    const session = makeSession({
      pluginEvents: [
        phaseChange(1000, "off", "specifying"),
        phaseChange(2000, "specifying", "implementing"),
        phaseChange(3000, "implementing", "refactoring"),
        phaseChange(4000, "refactoring", "specifying"),
        phaseChange(5000, "specifying", "implementing"),
        phaseChange(6000, "implementing", "refactoring"),
        phaseChange(7000, "refactoring", "specifying"),
        phaseChange(8000, "specifying", "implementing"),
        phaseChange(9000, "implementing", "refactoring"),
      ],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 3 implementing cycles >= 3 taskCount => +10
    // + 20 (no prod writes during specifying)
    expect(score).toBe(30);
  });

  it("gives partial cycle score when below taskCount", () => {
    const session = makeSession({
      pluginEvents: [phaseChange(1000, "off", "specifying"), phaseChange(2000, "specifying", "implementing")],
    });
    // 1 cycle out of 3 => round(1/3 * 10) = 3
    const { score } = scoreTddCompliance(session, 3);
    // 3 (partial cycle) + 20 (no spec prod writes)
    expect(score).toBe(23);
  });

  it("caps at 100 for a perfect session", () => {
    const session = makeSession({
      toolCalls: [
        { timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "TDD enabled", wasBlocked: false },
        { timestamp: 9500, name: "tdd_done", arguments: {}, resultText: "TDD disabled", wasBlocked: false },
      ],
      fileWrites: [
        { timestamp: 2000, path: "calc.test.ts", tool: "write", labels: ["test"] },
        { timestamp: 4000, path: "calc.ts", tool: "write", labels: ["production"] },
      ],
      pluginEvents: [
        phaseChange(1000, "off", "specifying"),
        testRun(2500, false),
        phaseChange(2500, "specifying", "implementing"),
        testRun(4500, true),
        phaseChange(4500, "implementing", "refactoring"),
        phaseChange(5000, "refactoring", "specifying"),
        testRun(5500, false),
        phaseChange(5500, "specifying", "implementing"),
        testRun(6500, true),
        phaseChange(6500, "implementing", "refactoring"),
        phaseChange(7000, "refactoring", "specifying"),
        testRun(7500, false),
        phaseChange(7500, "specifying", "implementing"),
        testRun(8500, true),
        phaseChange(8500, "implementing", "refactoring"),
      ],
    });
    const { score } = scoreTddCompliance(session, 3);
    // 15 + 5 + 25 + 20 + 25 + 10 = 100
    expect(score).toBe(100);
  });
});

// -- scoreInfrastructure ------------------------------------------------------

describe("scoreInfrastructure", () => {
  it("returns 25 with empty session (non-monorepo baseline)", () => {
    const score = scoreInfrastructure(makeSession(), makeVerify({ passed: false }), false);
    // Only the non-monorepo bonus: +25
    expect(score).toBe(25);
  });

  it("scores auto-detection (+30)", () => {
    const session = makeSession({
      toolCalls: [{ timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "TDD enabled", wasBlocked: false }],
    });
    const score = scoreInfrastructure(session, makeVerify({ passed: false }), false);
    // 30 (auto-detect) + 25 (non-monorepo)
    expect(score).toBe(55);
  });

  it("scores verify passed (+20)", () => {
    const score = scoreInfrastructure(makeSession(), makeVerify({ passed: true }), false);
    // 20 (verify) + 25 (non-monorepo)
    expect(score).toBe(45);
  });

  it("scores test runs (+25)", () => {
    const session = makeSession({
      pluginEvents: [testRun(2000, true)],
    });
    const score = scoreInfrastructure(session, makeVerify({ passed: false }), false);
    // 25 (test runs) + 25 (non-monorepo)
    expect(score).toBe(50);
  });

  it("gives monorepo bonus only when auto-detected", () => {
    const session = makeSession({
      toolCalls: [{ timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "TDD enabled", wasBlocked: false }],
    });
    const score = scoreInfrastructure(session, makeVerify({ passed: false }), true);
    // 30 (auto-detect) + 25 (monorepo + auto-detected)
    expect(score).toBe(55);
  });

  it("denies monorepo bonus without auto-detection", () => {
    const score = scoreInfrastructure(makeSession(), makeVerify({ passed: false }), true);
    // No auto-detect, monorepo but not auto-detected => 0
    expect(score).toBe(0);
  });

  it("caps at 100", () => {
    const session = makeSession({
      toolCalls: [{ timestamp: 1000, name: "tdd_start", arguments: {}, resultText: "TDD enabled", wasBlocked: false }],
      pluginEvents: [testRun(2000, true)],
    });
    const score = scoreInfrastructure(session, makeVerify({ passed: true }), false);
    // 30 + 20 + 25 + 25 = 100
    expect(score).toBe(100);
  });
});

// -- scoreCorrectness ---------------------------------------------------------

describe("scoreCorrectness", () => {
  it("returns 20 with empty session (no files = +20 for no suspicious edits)", () => {
    const score = scoreCorrectness(makeSession(), makeVerify({ passed: false, metrics: {} }));
    // 0 (verify fail) + 20 (no suspicious edits) + 0 (no prod) + 0 (no verify+prod)
    expect(score).toBe(20);
  });

  it("scores verify passed (+50)", () => {
    const score = scoreCorrectness(makeSession(), makeVerify({ passed: true, metrics: {} }));
    // 50 (verify) + 20 (no suspicious edits)
    expect(score).toBe(70);
  });

  it("scores production file count (+15)", () => {
    const score = scoreCorrectness(makeSession(), makeVerify({ passed: false, metrics: { productionFileCount: 5 } }));
    // 0 (verify) + 20 (no suspicious) + 15 (prod count)
    expect(score).toBe(35);
  });

  it("scores verify + prod count bonus (+15)", () => {
    const score = scoreCorrectness(makeSession(), makeVerify({ passed: true, metrics: { productionFileCount: 5 } }));
    // 50 (verify) + 20 (no suspicious) + 15 (prod count) + 15 (verify+prod)
    expect(score).toBe(100);
  });

  it("gives 20 for few suspicious test edits after production", () => {
    const session = makeSession({
      fileWrites: [
        { timestamp: 2000, path: "calc.ts", tool: "write", labels: ["production"] },
        { timestamp: 3000, path: "calc.test.ts", tool: "edit", labels: ["test"] },
        { timestamp: 4000, path: "calc.test.ts", tool: "edit", labels: ["test"] },
      ],
    });
    const score = scoreCorrectness(session, makeVerify({ passed: false, metrics: {} }));
    // 0 (verify) + 20 (<=2 suspicious edits) + 0 (no prod count)
    expect(score).toBe(20);
  });

  it("gives 10 for many suspicious test edits after production", () => {
    const session = makeSession({
      fileWrites: [
        { timestamp: 2000, path: "calc.ts", tool: "write", labels: ["production"] },
        { timestamp: 3000, path: "calc.test.ts", tool: "edit", labels: ["test"] },
        { timestamp: 4000, path: "calc.test.ts", tool: "edit", labels: ["test"] },
        { timestamp: 5000, path: "calc.test.ts", tool: "edit", labels: ["test"] },
      ],
    });
    const score = scoreCorrectness(session, makeVerify({ passed: false, metrics: {} }));
    // 0 (verify) + 10 (>2 suspicious edits) + 0 (no prod count)
    expect(score).toBe(10);
  });
});

// -- configure ----------------------------------------------------------------

describe("configure", () => {
  it("changes taskCount used by scoreSession", () => {
    configure({ taskCount: 1 });

    // 1 implementing cycle with taskCount=1 should give full cycle score
    const session = makeSession({
      pluginEvents: [phaseChange(1000, "off", "specifying"), phaseChange(2000, "specifying", "implementing")],
    });
    const { score } = scoreTddCompliance(session, 1);
    // 10 (1 cycle >= 1 taskCount) + 20 (no spec prod writes)
    expect(score).toBe(30);

    // Reset
    configure({ taskCount: 3 });
  });
});

describe("classifyFile", () => {
  it("treats runner configs as config rather than production", () => {
    expect(plugin.classifyFile?.("vitest.config.ts")).toBe("config");
    expect(plugin.classifyFile?.("frontend/jest.config.cjs")).toBe("config");
    expect(plugin.classifyFile?.("frontend\\jest.config.cjs")).toBe("config");
    expect(plugin.classifyFile?.("Gemfile")).toBe("config");
    expect(plugin.classifyFile?.("mix.exs")).toBe("config");
    expect(plugin.classifyFile?.("pom.xml")).toBe("config");
    expect(plugin.classifyFile?.("build.gradle")).toBe("config");
    expect(plugin.classifyFile?.("build.gradle.kts")).toBe("config");
    expect(plugin.classifyFile?.("phpunit.xml")).toBe("config");
    expect(plugin.classifyFile?.("phpunit.xml.dist")).toBe("config");
    expect(plugin.classifyFile?.("setup.py")).toBe("config");
    expect(plugin.classifyFile?.("backend\\project.csproj")).toBe("config");
    expect(plugin.classifyFile?.("backend\\solution.sln")).toBe("config");
    expect(plugin.classifyFile?.("src/app.config.ts")).toBe("production");
  });
});

// -- verify -------------------------------------------------------------------

describe("verify", () => {
  it("runs subdirectory test commands for monorepos", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tdd-monorepo-"));

    try {
      fs.mkdirSync(path.join(workDir, "backend"));
      fs.mkdirSync(path.join(workDir, "frontend"));
      fs.writeFileSync(
        path.join(workDir, "backend", "package.json"),
        JSON.stringify({
          name: "backend",
          private: true,
          scripts: { test: 'node -e "process.exit(0)"' },
        }),
      );
      fs.writeFileSync(
        path.join(workDir, "frontend", "package.json"),
        JSON.stringify({
          name: "frontend",
          private: true,
          scripts: { test: 'node -e "process.exit(0)"' },
        }),
      );

      configure({ isMonorepo: true });
      const result = plugin.verify?.(workDir);

      expect(result?.passed).toBe(true);
      expect(result?.output).toContain("## backend");
      expect(result?.output).toContain("## frontend");
    } finally {
      configure({ isMonorepo: false, taskCount: 3 });
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
