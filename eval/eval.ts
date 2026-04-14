import * as fs from "node:fs";
import * as path from "node:path";
import {
  compareSuiteReports,
  createSuiteReport,
  defaultVerify,
  type EvalPlugin,
  type EvalReport,
  type JudgeResult,
  loadLatestSuiteReport,
  loadPreviousSuiteReport,
  loadSuiteReport,
  parseSessionLines,
  printAggregatedSummary,
  printSuiteComparison,
  printSummary,
  runEval,
  runJudge,
  scoreSession,
  updateRunIndex,
  updateSuiteIndex,
  writeReport,
  writeSuiteReport,
} from "pi-do-eval";

import { getActiveEvalProviders, validateSuiteConcurrency } from "./providers.js";
import {
  type EvalConfig,
  getStacks,
  type ModelConfig,
  type SuiteEntry,
  type TrialConfig,
  type VariantConfig,
} from "./types.js";
import { stageTrialPrd } from "./workspace.js";

const TRIALS_DIR = path.join(import.meta.dirname, "trials");
const PLUGINS_DIR = path.join(import.meta.dirname, "plugins");
const RUNS_DIR = path.join(import.meta.dirname, "runs");
const DEFAULT_REGRESSION_THRESHOLD = 3;

interface SuiteContext {
  suite: string;
  suiteRunId: string;
}

interface RunTrialOpts {
  noJudge?: boolean;
  worker?: ModelConfig;
  judge?: ModelConfig;
  timeouts?: EvalConfig["timeouts"];
  epoch?: number;
  totalEpochs?: number;
}

interface RunTrialResult {
  report: EvalReport;
  runDir: string;
}

async function loadConfig(trialName: string): Promise<TrialConfig> {
  const configPath = path.join(TRIALS_DIR, trialName, "config.ts");
  const mod = await import(configPath);
  return mod.default;
}

async function loadPlugin(pluginName: string, config: TrialConfig, isMonorepo: boolean): Promise<EvalPlugin> {
  const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.ts`);
  const mod = await import(pluginPath);
  mod.configure?.({ taskCount: config.taskCount, isMonorepo });
  return mod.default;
}

function listTrials(): string[] {
  return fs.readdirSync(TRIALS_DIR).filter((dirName) => {
    return (
      fs.statSync(path.join(TRIALS_DIR, dirName)).isDirectory() &&
      fs.existsSync(path.join(TRIALS_DIR, dirName, "config.ts"))
    );
  });
}

async function loadEvalConfig(): Promise<EvalConfig> {
  const configPath = path.join(import.meta.dirname, "eval.config.ts");
  if (!fs.existsSync(configPath)) return {};
  const mod = await import(configPath);
  return mod.default;
}

function buildPrompt(variant: VariantConfig, prdFile: string): string {
  const stacks = getStacks(variant);
  const stackInstructions = stacks.map((stack) => {
    const prefix = stack.scope ? `For the ${stack.scope}:` : "";
    const core = `Use ${stack.language} with ${stack.testFramework} for testing.`;
    const parts = [prefix, core, stack.setup ?? ""].filter(Boolean);
    return parts.join(" ");
  });
  return ["Implement all user stories in the attached PRD.", ...stackInstructions, "Work through every user story without stopping. Do not ask for confirmation between features.", `@${prdFile}`].join(" ");
}

function getConfiguredSuites(config: EvalConfig): Record<string, SuiteEntry[]> {
  return {
    ...(config.runSets ?? {}),
    ...(config.suites ?? {}),
  };
}

function buildTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function getNumberFlag(args: string[], name: string): number | undefined {
  const value = getFlag(args, name);
  if (!value) return undefined;

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for --${name}: ${value}`);
    process.exit(1);
  }

  return parsed;
}

function getSuiteConcurrency(args: string[], config: EvalConfig): number {
  const parsed = getNumberFlag(args, "concurrency") ?? config.execution?.suiteConcurrency ?? 1;

  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`Invalid concurrency: ${parsed}. Use a positive integer.`);
    process.exit(1);
  }

  return parsed;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let currentIndex = 0;

  async function worker() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      await fn(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function runTrial(
  trialName: string,
  variantName: string,
  opts: RunTrialOpts,
  suiteContext?: SuiteContext,
): Promise<RunTrialResult> {
  const config = await loadConfig(trialName);
  const variant = config.variants[variantName];
  if (!variant) {
    console.error(
      `Unknown variant "${variantName}" for ${trialName}. Available: ${Object.keys(config.variants).join(", ")}`,
    );
    process.exit(1);
  }

  const plugin = await loadPlugin(config.plugin, config, getStacks(variant).length > 1);

  const timestamp = buildTimestamp();
  const runName = `${timestamp}-${trialName}-${variantName}`;
  const workDir = path.join(RUNS_DIR, runName, "workdir");
  const runDir = path.join(RUNS_DIR, runName);
  fs.mkdirSync(workDir, { recursive: true });

  const stackLabel = getStacks(variant)
    .map((stack) => `${stack.language}/${stack.testFramework}`)
    .join(", ");
  const epochLabel = opts.totalEpochs && opts.totalEpochs > 1 ? ` [epoch ${opts.epoch}/${opts.totalEpochs}]` : "";
  console.log(`Running ${trialName}/${variantName} (${stackLabel})${epochLabel}`);
  console.log(`  Plugin: ${plugin.name}`);
  console.log(`  Work dir: ${workDir}`);
  if (suiteContext) console.log(`  Suite: ${suiteContext.suite} (${suiteContext.suiteRunId})`);

  const trialDir = path.join(TRIALS_DIR, trialName);
  let prdPath: string;
  try {
    prdPath = stageTrialPrd(trialDir, workDir, config.prdFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const prompt = buildPrompt(variant, config.prdFile);

  const result = await runEval({
    trialDir,
    workDir,
    prompt,
    extensionPath: plugin.extensionPath,
    plugin,
    timeoutMs: opts.timeouts?.workerMs,
    inactivityMs: opts.timeouts?.inactivityMs,
    provider: opts.worker?.provider,
    model: opts.worker?.model,
    thinking: opts.worker?.thinking,
    live: {
      runDir,
      runsDir: RUNS_DIR,
      meta: {
        trial: trialName,
        variant: variantName,
        ...(suiteContext ?? {}),
        ...(opts.epoch ? { epoch: opts.epoch, totalEpochs: opts.totalEpochs } : {}),
      },
    },
  });

  console.log(`  Worker: ${result.status} (exit ${result.exitCode})`);
  if (result.stderr) fs.writeFileSync(path.join(runDir, "stderr.txt"), result.stderr);
  fs.writeFileSync(path.join(runDir, "session.jsonl"), result.session.rawLines.join("\n"));

  const session = parseSessionLines(result.session.rawLines, plugin);
  session.exitCode = result.exitCode;

  const verify = plugin.verify ? plugin.verify(workDir) : defaultVerify();
  console.log(`  Verify: ${verify.passed ? "PASS" : "FAIL"}`);

  let judgeResult: JudgeResult | undefined;
  let judgeFailure: string | undefined;
  if (!opts.noJudge) {
    if (fs.existsSync(prdPath)) {
      console.log("  Judge: evaluating...");
      const prd = fs.readFileSync(prdPath, "utf-8");
      const judgePrompt = plugin.buildJudgePrompt(prd, workDir);
      const judgeOutcome = await runJudge({
        workDir,
        prompt: judgePrompt,
        timeoutMs: opts.timeouts?.judgeMs,
        provider: opts.judge?.provider,
        model: opts.judge?.model,
        thinking: opts.judge?.thinking,
      });
      if (judgeOutcome.ok) {
        judgeResult = judgeOutcome.result;
        for (const [key, value] of Object.entries(judgeResult.scores)) {
          const reason = judgeResult.reasons[key] ?? "";
          console.log(`  Judge: ${key} = ${value}${reason ? ` — ${reason}` : ""}`);
        }
        if (judgeResult.findings.length > 0) {
          for (const finding of judgeResult.findings) console.log(`  Judge finding: ${finding}`);
        }
      } else {
        judgeFailure = judgeOutcome.reason;
        console.log(`  Judge: failed (${judgeFailure}), using deterministic scores only`);
      }
    }
  }

  const scores = scoreSession({
    session,
    verify,
    plugin,
    judgeResult,
  });

  const findings: string[] = [];
  const pluginResult = plugin.scoreSession(session, verify);
  findings.push(...pluginResult.findings);
  if (!verify.passed) findings.push("Verification failed");
  if (result.status !== "completed") findings.push(`Session ended with status: ${result.status}`);
  if (judgeResult?.findings) findings.push(...judgeResult.findings);
  if (judgeFailure) findings.push(`Judge failed: ${judgeFailure}`);

  const workerModel = session.modelInfo
    ? `${session.modelInfo.provider}/${session.modelInfo.model}`
    : (opts.worker?.model ?? "default");
  const judgeModel = opts.judge?.model ?? "default";

  const report: EvalReport = {
    meta: {
      trial: trialName,
      variant: variantName,
      workerModel,
      ...(judgeResult ? { judgeModel } : {}),
      startedAt: new Date(session.startTime).toISOString(),
      durationMs: session.endTime - session.startTime,
      status: result.status,
      ...(suiteContext ?? {}),
      ...(opts.epoch ? { epoch: opts.epoch, totalEpochs: opts.totalEpochs } : {}),
    },
    scores,
    ...(judgeResult ? { judgeResult } : {}),
    session: { ...session, rawLines: [] },
    findings,
  };

  writeReport(report, runDir);
  updateRunIndex(RUNS_DIR);
  printSummary(report);

  return { report, runDir };
}

async function runSuite(suiteName: string, entries: SuiteEntry[], opts: RunTrialOpts, concurrency: number) {
  const suiteRunId = buildTimestamp();
  const globalEpochs = evalConfig.epochs ?? 1;
  const allReports: Array<{ report: EvalReport; runDir: string }> = [];
  let maxEpochs = 1;

  for (const entry of entries) {
    const epochs = entry.epochs ?? globalEpochs;
    if (epochs > maxEpochs) maxEpochs = epochs;

    // Run each epoch; within an epoch, respect concurrency for parallelism
    for (let e = 1; e <= epochs; e++) {
      const epochOpts: RunTrialOpts = {
        ...opts,
        ...(epochs > 1 ? { epoch: e, totalEpochs: epochs } : {}),
      };
      const result = await runTrial(entry.trial, entry.variant, epochOpts, { suite: suiteName, suiteRunId });
      allReports.push({
        report: result.report,
        runDir: path.relative(RUNS_DIR, result.runDir),
      });
    }
  }

  // Compare with previous suite run before writing (so comparison gets embedded)
  let comparison;
  const previous = loadPreviousSuiteReport(RUNS_DIR, suiteName, suiteRunId);

  const suiteReport = createSuiteReport(
    suiteName, suiteRunId, allReports,
    new Date().toISOString(),
    maxEpochs > 1 ? maxEpochs : undefined,
  );

  if (previous) {
    comparison = compareSuiteReports(
      suiteReport, previous,
      { threshold: evalConfig.regressions?.threshold },
    );
    suiteReport.comparison = comparison;
  }

  writeSuiteReport(suiteReport, RUNS_DIR);
  updateSuiteIndex(RUNS_DIR);

  console.log(`\nSuite ${suiteName} (${suiteRunId})`);
  console.log(`  Runs: ${suiteReport.summary.totalRuns}`);
  console.log(`  Completed: ${suiteReport.summary.completedRuns}`);
  console.log(`  Verify failures: ${suiteReport.summary.verifyFailureCount}`);
  console.log(`  Hard failures: ${suiteReport.summary.hardFailureCount}`);
  console.log(`  Average overall: ${suiteReport.summary.averageOverall}/100\n`);

  if (suiteReport.aggregated) {
    console.log("--- Aggregated Results ---");
    for (const agg of suiteReport.aggregated) {
      printAggregatedSummary(agg);
    }
  }

  if (comparison) {
    printSuiteComparison(comparison);
    if (comparison.hasRegression) process.exit(1);
  }
}

function printUsage() {
  console.log("pi-tdd eval suite");
  console.log("");
  console.log("Usage:");
  console.log("  eval list                                        List trials, variants, and suites");
  console.log("  eval run <suite>                                 Run a named suite from eval.config.ts");
  console.log("  eval run --trial <t> --variant <v>               Run a single trial/variant");
  console.log("  eval regress <suite> [--against <suite-run-id>]  Compare the latest suite run to a baseline");
  console.log("  eval run-all                                     Run all trials and variants");
  console.log("");
  console.log("Options:");
  console.log("  --no-judge                  Skip LLM judge (deterministic only)");
  console.log("  --concurrency <n>           Run up to n suite entries at once (default 1)");
  console.log(`  --threshold <n>             Override regression threshold (default ${DEFAULT_REGRESSION_THRESHOLD})`);
}

const args = process.argv.slice(2);
const command = args[0];
const evalConfig = await loadEvalConfig();

function buildRunOpts(): RunTrialOpts {
  return {
    noJudge: hasFlag(args, "no-judge"),
    worker: evalConfig.worker,
    judge: evalConfig.judge,
    timeouts: evalConfig.timeouts,
  };
}

const configuredSuites = getConfiguredSuites(evalConfig);

if (command === "list") {
  const trials = listTrials();
  for (const trialName of trials) {
    const config = await loadConfig(trialName);
    const variants = Object.keys(config.variants).join(", ");
    console.log(`${trialName} [${config.plugin}] (${config.taskCount} tasks) -- variants: ${variants}`);
  }

  if (Object.keys(configuredSuites).length > 0) {
    console.log("\nSuites:");
    for (const [suiteName, entries] of Object.entries(configuredSuites)) {
      const labels = entries.map((entry) => `${entry.trial}/${entry.variant}`).join(", ");
      console.log(`  ${suiteName} (${entries.length}): ${labels}`);
    }
  }
} else if (command === "run") {
  const trial = getFlag(args, "trial");
  const variant = getFlag(args, "variant");
  const suiteName = args[1] && !args[1].startsWith("--") ? args[1] : undefined;

  if (trial && variant) {
    await runTrial(trial, variant, buildRunOpts());
  } else if (suiteName) {
    const entries = configuredSuites[suiteName];
    if (!entries) {
      const available = Object.keys(configuredSuites).join(", ");
      console.error(`Unknown suite "${suiteName}". Available: ${available}`);
      process.exit(1);
    }
    const suiteConcurrency = getSuiteConcurrency(args, evalConfig);
    const activeProviders = getActiveEvalProviders(evalConfig, {
      noJudge: hasFlag(args, "no-judge"),
      startDir: import.meta.dirname,
    });
    const concurrencyError = validateSuiteConcurrency(suiteConcurrency, activeProviders);
    if (concurrencyError) {
      console.error(concurrencyError);
      process.exit(1);
    }
    await runSuite(suiteName, entries, buildRunOpts(), suiteConcurrency);
  } else {
    console.error("Usage: eval run <suite-name>  OR  eval run --trial <t> --variant <v>");
    process.exit(1);
  }
} else if (command === "regress") {
  const suiteName = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  if (!suiteName) {
    console.error("Usage: eval regress <suite-name> [--against <suite-run-id>] [--threshold <n>]");
    process.exit(1);
  }

  const threshold =
    getNumberFlag(args, "threshold") ?? evalConfig.regressions?.threshold ?? DEFAULT_REGRESSION_THRESHOLD;
  const against = getFlag(args, "against");
  const current = loadLatestSuiteReport(RUNS_DIR, suiteName);
  if (!current) {
    console.error(`No completed suite runs found for "${suiteName}"`);
    process.exit(1);
  }

  const baseline = against
    ? loadSuiteReport(RUNS_DIR, suiteName, against)
    : loadPreviousSuiteReport(RUNS_DIR, suiteName, current.suiteRunId);
  if (!baseline) {
    if (against) {
      console.error(`Could not find suite run "${against}" for "${suiteName}"`);
    } else {
      console.error(`Need at least two completed suite runs for "${suiteName}" to compare regressions`);
    }
    process.exit(1);
  }

  const comparison = compareSuiteReports(current, baseline, { threshold });
  printSuiteComparison(comparison);
  if (comparison.hasRegression) process.exit(1);
} else if (command === "run-all") {
  const trials = listTrials();
  for (const trialName of trials) {
    const config = await loadConfig(trialName);
    for (const variantName of Object.keys(config.variants)) {
      await runTrial(trialName, variantName, buildRunOpts());
    }
  }
} else {
  printUsage();
}
