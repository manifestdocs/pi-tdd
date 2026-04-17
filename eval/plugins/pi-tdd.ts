import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EvalPlugin, EvalSession, PluginEvent, VerifyResult } from "pi-do-eval";

import { isConfigFile, isTestFile } from "../../src/file-classification.js";

const PI_TDD_PATH = path.resolve(import.meta.dirname, "../../src/index.ts");

const SOURCE_RE = /\.(ts|js|tsx|jsx|py|rb|rs|go|c|ex|exs|java|kt|php)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "target", "vendor", "__pycache__", "dist", ".next"]);

// -- Configurable state (set via configure() before scoring) ------------------

let projectTaskCount = 3;
let projectIsMonorepo = false;

export function configure(opts: { taskCount?: number; isMonorepo?: boolean }) {
  if (opts.taskCount !== undefined) projectTaskCount = opts.taskCount;
  if (opts.isMonorepo !== undefined) projectIsMonorepo = opts.isMonorepo;
}

// -- Helpers ------------------------------------------------------------------

function getPhaseChanges(session: EvalSession): PluginEvent[] {
  return session.pluginEvents.filter((e) => e.type === "phase_change");
}

function getTestRuns(session: EvalSession): PluginEvent[] {
  return session.pluginEvents.filter((e) => e.type === "test_run");
}

function filesWithLabel(session: EvalSession, label: string) {
  return session.fileWrites.filter((f) => f.labels.includes(label));
}

// -- Scoring (exported for testing) -------------------------------------------

export function scoreTddCompliance(session: EvalSession, taskCount: number): { score: number; findings: string[] } {
  const findings: string[] = [];
  let score = 0;

  const tddStart = session.toolCalls.find((c) => c.name === "tdd_start");
  const tddStarted = tddStart && !tddStart.resultText.includes("Could not");
  if (tddStarted) score += 15;
  else if (tddStart) findings.push(`tdd_start failed: ${tddStart.resultText}`);
  else findings.push("Agent never called tdd_start");

  if (session.toolCalls.some((c) => c.name === "tdd_done")) score += 5;

  const testWrites = filesWithLabel(session, "test");
  const prodWrites = filesWithLabel(session, "production");
  if (testWrites.length > 0 && prodWrites.length > 0) {
    if (Math.min(...testWrites.map((f) => f.timestamp)) < Math.min(...prodWrites.map((f) => f.timestamp))) score += 25;
  }

  // Phase gate: no production writes during specifying
  const phaseChanges = getPhaseChanges(session);
  const specRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < phaseChanges.length; i++) {
    const change = phaseChanges[i];
    if (!change) continue;
    if (change.data.to === "specifying") {
      const next = phaseChanges[i + 1];
      specRanges.push({ start: change.timestamp, end: next?.timestamp ?? session.endTime });
    }
  }
  const specProdWrites = prodWrites.filter((f) =>
    specRanges.some((r) => f.timestamp >= r.start && f.timestamp < r.end),
  ).length;
  if (specProdWrites === 0) score += 20;
  else score += Math.max(0, 20 - specProdWrites * 5);

  // Red-green ordering
  const testRuns = getTestRuns(session);
  const failRuns = testRuns.filter((r) => r.data.passed === false);
  const passRuns = testRuns.filter((r) => r.data.passed === true);
  if (failRuns.length > 0 && passRuns.length > 0) {
    if (passRuns.some((r) => r.timestamp > Math.min(...failRuns.map((f) => f.timestamp)))) score += 25;
  }

  // Cycle count
  const cycles = phaseChanges.filter((p) => p.data.to === "implementing").length;
  if (cycles >= taskCount) score += 10;
  else if (cycles > 0) score += Math.round((cycles / taskCount) * 10);

  return { score: Math.min(100, Math.round(score)), findings };
}

export function scoreInfrastructure(session: EvalSession, verify: VerifyResult, isMonorepo: boolean): number {
  let score = 0;

  const tddStart = session.toolCalls.find((c) => c.name === "tdd_start");
  const autoDetected = tddStart && !tddStart.resultText.includes("Could not");
  if (autoDetected) score += 30;
  if (verify.passed) score += 20;
  if (getTestRuns(session).length > 0) score += 25;

  if (isMonorepo) {
    if (autoDetected) score += 25;
  } else {
    score += 25;
  }

  return Math.min(100, Math.round(score));
}

export function scoreCorrectness(session: EvalSession, verify: VerifyResult): number {
  let score = 0;
  if (verify.passed) score += 50;

  const testEdits = filesWithLabel(session, "test").filter((f) => f.tool === "edit");
  const prodWrites = filesWithLabel(session, "production");
  if (prodWrites.length > 0 && testEdits.length > 0) {
    const firstProd = Math.min(...prodWrites.map((f) => f.timestamp));
    const suspicious = testEdits.filter((f) => f.timestamp > firstProd).length;
    score += suspicious <= 2 ? 20 : 10;
  } else {
    score += 20;
  }

  const prodCount = verify.metrics.productionFileCount ?? 0;
  if (prodCount > 0) score += 15;
  if (verify.passed && prodCount > 0) score += 15;

  return Math.min(100, Math.round(score));
}

// -- Verification -------------------------------------------------------------

function detectTestCommandInDir(dir: string): string | undefined {
  const exists = (name: string) => fs.existsSync(path.join(dir, name));

  if (exists("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      if (pkg.scripts?.test) return "npm test";
    } catch (err) {
      console.warn(`[pi-tdd] Failed to parse package.json in ${dir}:`, (err as Error).message);
    }
  }
  if (exists("Cargo.toml")) return "cargo test";
  if (exists("go.mod")) return "go test ./...";
  if (exists("pytest.ini") || exists("pyproject.toml")) return "pytest";
  if (exists("Gemfile")) return "bundle exec rake test";
  if (exists("mix.exs")) return "mix test";
  if (exists("Makefile")) {
    try {
      const content = fs.readFileSync(path.join(dir, "Makefile"), "utf-8");
      if (/^test\s*:/m.test(content)) return "make test";
    } catch (err) {
      console.warn(`[pi-tdd] Failed to read Makefile in ${dir}:`, (err as Error).message);
    }
  }
  return undefined;
}

interface TestCommandTarget {
  command: string;
  cwd: string;
  label: string;
}

function detectTestCommands(workDir: string): TestCommandTarget[] {
  const rootCommand = detectTestCommandInDir(workDir);
  const rootTarget = rootCommand ? [{ command: rootCommand, cwd: workDir, label: "." }] : [];
  const subdirTargets = fs
    .readdirSync(workDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name))
    .map((entry) => {
      const cwd = path.join(workDir, entry.name);
      const command = detectTestCommandInDir(cwd);
      return command ? { command, cwd, label: entry.name } : undefined;
    })
    .filter((target): target is TestCommandTarget => target !== undefined);

  if (projectIsMonorepo) {
    return subdirTargets.length > 0 ? subdirTargets : rootTarget;
  }

  return rootTarget.length > 0 ? rootTarget : subdirTargets;
}

function countFiles(dir: string, predicate: (f: string) => boolean): number {
  let count = 0;
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(entry.name)) count++;
    }
  }
  try {
    walk(dir);
  } catch (err) {
    console.warn(`[pi-tdd] Error counting files in ${dir}:`, (err as Error).message);
  }
  return count;
}

// -- File collection for judge ------------------------------------------------

function collectSourceFiles(dir: string): { testFiles: string[]; prodFiles: string[] } {
  const testFiles: string[] = [];
  const prodFiles: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_RE.test(entry.name)) {
        const rel = path.relative(dir, full);
        if (isTestFile(rel)) testFiles.push(rel);
        else prodFiles.push(rel);
      }
    }
  }
  try {
    walk(dir);
  } catch (err) {
    console.warn(`[pi-tdd] Error collecting source files in ${dir}:`, (err as Error).message);
  }
  return { testFiles, prodFiles };
}

function readFiles(dir: string, files: string[], max = 5000): string {
  return files
    .map((f) => {
      try {
        const content = fs.readFileSync(path.join(dir, f), "utf-8");
        const trimmed = content.length > max ? `${content.slice(0, max)}\n... (truncated)` : content;
        return `### ${f}\n\`\`\`\n${trimmed}\n\`\`\``;
      } catch {
        return `### ${f}\n(unreadable)`;
      }
    })
    .join("\n\n");
}

// -- Plugin -------------------------------------------------------------------

const piTddPlugin: EvalPlugin = {
  name: "pi-tdd",
  extensionPath: PI_TDD_PATH,

  classifyFile(filePath) {
    if (isTestFile(filePath)) return "test";
    if (isConfigFile(filePath)) return "config";
    return "production";
  },

  parseEvent(_toolName, resultText, timestamp) {
    const events: PluginEvent[] = [];

    if (resultText.includes("TDD enabled")) {
      events.push({ timestamp, type: "phase_change", data: { from: "off", to: "specifying", trigger: "tdd_start" } });
    }

    const phaseMatch = resultText.match(/\[TDD (SPECIFYING|IMPLEMENTING|REFACTORING)\] Tests (PASS|FAIL)/);
    if (phaseMatch) {
      const phase = phaseMatch[1]?.toLowerCase();
      const passed = phaseMatch[2] === "PASS";
      events.push({ timestamp, type: "test_run", data: { passed, command: "auto" } });
      if (phase === "specifying" && !passed) {
        events.push({
          timestamp,
          type: "phase_change",
          data: { from: "specifying", to: "implementing", trigger: "test_fail" },
        });
      }
      if (phase === "implementing" && passed) {
        events.push({
          timestamp,
          type: "phase_change",
          data: { from: "implementing", to: "refactoring", trigger: "test_pass" },
        });
      }
    }

    if (resultText.includes("TDD disabled") || resultText.includes("TDD off")) {
      events.push({ timestamp, type: "phase_change", data: { from: "unknown", to: "off", trigger: "tdd_done" } });
    }

    return events;
  },

  verify(workDir) {
    const commands = detectTestCommands(workDir);
    const testFileCount = countFiles(workDir, (f) => isTestFile(f));
    const allSrc = countFiles(workDir, (f) => SOURCE_RE.test(f));

    if (commands.length === 0) {
      return {
        passed: false,
        output: "No test command detected",
        metrics: { testFileCount, productionFileCount: allSrc - testFileCount },
      };
    }

    let passed = true;
    const outputParts: string[] = [];
    for (const target of commands) {
      try {
        const output = execSync(target.command, {
          cwd: target.cwd,
          timeout: 60_000,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        outputParts.push(`## ${target.label}\n${output.trim() || "(no output)"}`);
      } catch (err: unknown) {
        passed = false;
        if (err && typeof err === "object" && "stdout" in err) {
          const e = err as { stdout?: string; stderr?: string };
          const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
          outputParts.push(`## ${target.label}\n${output || "(no output)"}`);
        } else {
          outputParts.push(`## ${target.label}\n${String(err)}`);
        }
      }
    }

    return {
      passed,
      output: outputParts.join("\n\n"),
      metrics: { testFileCount, productionFileCount: allSrc - testFileCount },
    };
  },

  scoreSession(session, verify) {
    const tdd = scoreTddCompliance(session, projectTaskCount);
    const infra = scoreInfrastructure(session, verify, projectIsMonorepo);
    const correct = scoreCorrectness(session, verify);

    return {
      scores: { tddCompliance: tdd.score, infrastructure: infra, correctness: correct },
      weights: { tddCompliance: 0.35, infrastructure: 0.15, correctness: 0.25 },
      findings: tdd.findings,
    };
  },

  buildJudgePrompt(prd, workDir) {
    const { testFiles, prodFiles } = collectSourceFiles(workDir);
    const testContent = readFiles(workDir, testFiles);
    const prodContent = readFiles(workDir, prodFiles);

    return [
      "You are evaluating code built from a PRD using TDD. Respond with ONLY a JSON object.",
      "",
      "## PRD",
      prd,
      "",
      "## Test Files",
      testContent || "(no test files found)",
      "",
      "## Production Files",
      prodContent || "(no production files found)",
      "",
      "## Evaluation Criteria",
      "",
      "Answer with a JSON object containing:",
      "",
      '- "test_quality" (0-100): Do the tests verify meaningful behavior from the user stories?',
      '- "test_quality_reason" (string): Brief explanation.',
      '- "prd_coverage" (0-100): How completely does the implementation cover the PRD?',
      '- "prd_coverage_reason" (string): Brief explanation.',
      '- "tdd_test_first" (0-100): Do the tests describe behavior (what the code should do)',
      "  rather than implementation details? Behavior-style tests score higher.",
      '- "tdd_test_first_reason" (string): Brief explanation.',
      '- "findings" (string[]): Notable observations.',
      "",
      "Respond with ONLY the JSON object.",
    ].join("\n");
  },

  formatSummary(session) {
    const phaseChanges = getPhaseChanges(session);
    const testRuns = getTestRuns(session);
    const testFiles = filesWithLabel(session, "test").length;
    const prodFiles = filesWithLabel(session, "production").length;
    const passCount = testRuns.filter((r) => r.data.passed === true).length;
    const failCount = testRuns.filter((r) => r.data.passed === false).length;

    const lines = [
      `- Tool calls: ${session.toolCalls.length}`,
      `- File writes: ${session.fileWrites.length} (${testFiles} test, ${prodFiles} production)`,
      `- Test runs: ${testRuns.length} (${passCount} passed, ${failCount} failed)`,
      `- Phase changes: ${phaseChanges.map((p) => p.data.to).join(" -> ")}`,
    ];

    if (phaseChanges.length > 0) {
      lines.push("");
      lines.push("### Phase Timeline");
      for (const p of phaseChanges) {
        const t = new Date(p.timestamp).toISOString().slice(11, 19);
        lines.push(`- \`${t}\` ${p.data.from} -> ${p.data.to} (${p.data.trigger})`);
      }
    }

    return lines;
  },
};

export default piTddPlugin;
