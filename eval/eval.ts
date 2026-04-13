import * as fs from "node:fs";
import * as path from "node:path";
import {
  defaultVerify,
  type EvalPlugin,
  type EvalReport,
  type JudgeResult,
  parseSessionLines,
  printSummary,
  runEval,
  runJudge,
  scoreSession,
  updateRunIndex,
  writeReport,
} from "pi-do-eval";

import { type EvalConfig, getStacks, type ModelConfig, type TrialConfig, type VariantConfig } from "./types.js";

const TRIALS_DIR = path.join(import.meta.dirname, "trials");
const PLUGINS_DIR = path.join(import.meta.dirname, "plugins");
const RUNS_DIR = path.join(import.meta.dirname, "runs");

async function loadConfig(trialName: string): Promise<TrialConfig> {
  const configPath = path.join(TRIALS_DIR, trialName, "config.ts");
  const mod = await import(configPath);
  return mod.default;
}

async function loadPlugin(pluginName: string, config: TrialConfig): Promise<EvalPlugin> {
  const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.ts`);
  const mod = await import(pluginPath);
  mod.configure?.({ taskCount: config.taskCount });
  return mod.default;
}

function listTrials(): string[] {
  return fs.readdirSync(TRIALS_DIR).filter((d) => {
    return (
      fs.statSync(path.join(TRIALS_DIR, d)).isDirectory() && fs.existsSync(path.join(TRIALS_DIR, d, "config.ts"))
    );
  });
}

async function loadEvalConfig(): Promise<EvalConfig> {
  const configPath = path.join(import.meta.dirname, "eval.config.ts");
  if (!fs.existsSync(configPath)) return {};
  const mod = await import(configPath);
  return mod.default;
}

function buildPrompt(variant: VariantConfig): string {
  const stacks = getStacks(variant);
  const stackInstructions = stacks.map((s) => {
    const prefix = s.scope ? `For the ${s.scope}:` : "";
    const core = `Use ${s.language} with ${s.testFramework} for testing.`;
    const parts = [prefix, core, s.setup ?? ""].filter(Boolean);
    return parts.join(" ");
  });
  return ["Implement all user stories in the attached PRD.", ...stackInstructions, "@PRD.md"].join(" ");
}

interface RunTrialOpts {
  noJudge?: boolean;
  worker?: ModelConfig;
  judge?: ModelConfig;
  timeouts?: EvalConfig["timeouts"];
}

async function runTrial(trialName: string, variantName: string, opts: RunTrialOpts) {
  const config = await loadConfig(trialName);
  const variant = config.variants[variantName];
  if (!variant) {
    console.error(
      `Unknown variant "${variantName}" for ${trialName}. Available: ${Object.keys(config.variants).join(", ")}`,
    );
    process.exit(1);
  }

  const plugin = await loadPlugin(config.plugin, config);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runName = `${timestamp}-${trialName}-${variantName}`;
  const workDir = path.join(RUNS_DIR, runName, "workdir");
  const runDir = path.join(RUNS_DIR, runName);
  fs.mkdirSync(workDir, { recursive: true });

  const stackLabel = getStacks(variant)
    .map((s) => `${s.language}/${s.testFramework}`)
    .join(", ");
  console.log(`Running ${trialName}/${variantName} (${stackLabel})`);
  console.log(`  Plugin: ${plugin.name}`);
  console.log(`  Work dir: ${workDir}`);

  const prompt = buildPrompt(variant);
  const trialDir = path.join(TRIALS_DIR, trialName);

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
      meta: { trial: trialName, variant: variantName },
    },
  });

  console.log(`  Worker: ${result.status} (exit ${result.exitCode})`);
  if (result.stderr) fs.writeFileSync(path.join(runDir, "stderr.txt"), result.stderr);
  fs.writeFileSync(path.join(runDir, "session.jsonl"), result.session.rawLines.join("\n"));

  // Re-parse with plugin for classification and event detection
  const session = parseSessionLines(result.session.rawLines, plugin);
  session.exitCode = result.exitCode;

  // Verification via plugin or default
  const verify = plugin.verify ? plugin.verify(workDir) : defaultVerify();
  console.log(`  Verify: ${verify.passed ? "PASS" : "FAIL"}`);

  // Judge step
  let judgeResult: JudgeResult | undefined;
  let judgeFailure: string | undefined;
  if (!opts.noJudge) {
    const prdPath = path.join(workDir, "PRD.md");
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
          for (const f of judgeResult.findings) console.log(`  Judge finding: ${f}`);
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
    },
    scores,
    ...(judgeResult ? { judgeResult } : {}),
    session: { ...session, rawLines: [] },
    findings,
  };

  writeReport(report, runDir);
  updateRunIndex(RUNS_DIR);
  printSummary(report);
}

// -- CLI -----------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const evalConfig = await loadEvalConfig();

function buildRunOpts(): RunTrialOpts {
  return {
    noJudge: hasFlag("no-judge"),
    worker: evalConfig.worker,
    judge: evalConfig.judge,
    timeouts: evalConfig.timeouts,
  };
}

if (command === "list") {
  const trials = listTrials();
  for (const t of trials) {
    const config = await loadConfig(t);
    const variants = Object.keys(config.variants).join(", ");
    console.log(`${t} [${config.plugin}] (${config.taskCount} tasks) -- variants: ${variants}`);
  }

  if (evalConfig.runSets && Object.keys(evalConfig.runSets).length > 0) {
    console.log("\nRun sets:");
    for (const [name, entries] of Object.entries(evalConfig.runSets)) {
      const labels = entries.map((e) => `${e.trial}/${e.variant}`).join(", ");
      console.log(`  ${name} (${entries.length}): ${labels}`);
    }
  }
} else if (command === "run") {
  const trial = getFlag("trial");
  const variant = getFlag("variant");
  const setName = args[1] && !args[1].startsWith("--") ? args[1] : undefined;

  if (trial && variant) {
    await runTrial(trial, variant, buildRunOpts());
  } else if (setName) {
    const entries = evalConfig.runSets?.[setName];
    if (!entries) {
      const available = Object.keys(evalConfig.runSets ?? {}).join(", ");
      console.error(`Unknown run set "${setName}". Available: ${available}`);
      process.exit(1);
    }
    for (const entry of entries) {
      await runTrial(entry.trial, entry.variant, buildRunOpts());
    }
  } else {
    console.error("Usage: eval run <set-name>  OR  eval run --trial <t> --variant <v>");
    process.exit(1);
  }
} else if (command === "run-all") {
  const trials = listTrials();
  for (const t of trials) {
    const config = await loadConfig(t);
    for (const v of Object.keys(config.variants)) {
      await runTrial(t, v, buildRunOpts());
    }
  }
} else {
  console.log("pi-tdd eval suite");
  console.log("");
  console.log("Usage:");
  console.log("  eval list                                List trials, variants, and run sets");
  console.log("  eval run <set>                           Run a named set from eval.config.ts");
  console.log("  eval run --trial <t> --variant <v>       Run a single trial/variant");
  console.log("  eval run-all                             Run all trials and variants");
  console.log("");
  console.log("Options:");
  console.log("  --no-judge                  Skip LLM judge (deterministic only)");
}
