import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig, TDDPhase } from "./types.js";
import type { PhaseStateMachine } from "./phase.js";
import { formatPreflightResult, runPreflight } from "./preflight.js";
import { formatPostflightResult, runPostflight } from "./postflight.js";
import { maybeRunPostflightOnDisengage } from "./engagement.js";

const VALID_PHASES: TDDPhase[] = ["SPEC", "RED", "GREEN", "REFACTOR"];

type Publish = (message: string) => void;

export async function handleTddCommand(
  rawArgs: string,
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish,
  config?: TDDConfig
): Promise<void> {
  const args = splitCommandArgs(rawArgs);
  const sub = (args[0] ?? "status").toLowerCase();
  const configDisabled = config?.enabled === false;

  switch (sub) {
    case "status":
      publish(formatStatus(machine, configDisabled));
      return;

    case "spec":
    case "plan":
    case "red":
    case "green":
    case "refactor": {
      if (configDisabled) {
        publishDisabled(machine, ctx, publish);
        return;
      }

      const normalized = sub === "plan" ? "SPEC" : sub.toUpperCase();
      const target = normalized as TDDPhase;
      if (!VALID_PHASES.includes(target)) {
        publish(`Unknown phase: ${sub}. Valid phases: ${VALID_PHASES.join(", ")}.`);
        return;
      }

      // Pre-flight is a hard gate when transitioning out of SPEC into RED. The
      // spec checklist must validate before any code is written; failure blocks
      // the transition with no override. The agent must refine the spec and
      // retry. Power users can disable the gate entirely with
      // `runPreflightOnRed: false`.
      if (machine.phase === "SPEC" && target === "RED" && config?.runPreflightOnRed) {
        try {
          const result = await runPreflight({ spec: machine.plan }, ctx, config);
          if (!result.ok) {
            publish(formatPreflightResult(result));
            ctx.ui.notify(
              `Pre-flight blocked SPEC → RED: ${result.issues.length} issue(s)`,
              "warning"
            );
            return;
          }
          if (ctx.hasUI) {
            ctx.ui.notify("Pre-flight: OK", "info");
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          publish(`Pre-flight gate failed to run: ${reason}`);
          ctx.ui.notify(`Pre-flight gate failed: ${reason}`, "warning");
          return;
        }
      }

      if (machine.phase === "REFACTOR" && target === "RED" && machine.plan.length > 0) {
        machine.completePlanItem();
      }

      const wasDormant = !machine.enabled;
      machine.enabled = true;

      const ok = machine.transitionTo(target, "User forced via /tdd command", target !== machine.nextPhase());
      ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
      if (ok) {
        ctx.ui.notify(
          wasDormant ? `TDD engaged in ${target}` : `TDD phase -> ${target}`,
          "info"
        );
        publish(wasDormant ? `TDD engaged. Phase set to ${target}.` : `Phase set to ${target}.`);
      } else if (wasDormant) {
        ctx.ui.notify(`TDD engaged in ${target}`, "info");
        publish(`TDD engaged. Already in ${target} phase.`);
      } else {
        publish(`Already in ${target} phase.`);
      }
      return;
    }

    case "spec-set":
    case "plan-set": {
      const items = args.slice(1).filter(Boolean);
      if (items.length === 0) {
        publish('Usage: /tdd spec-set "Criterion 1" "Criterion 2" ...');
        return;
      }

      machine.setPlan(items);
      ctx.ui.notify(`Feature spec set with ${items.length} item(s)`, "info");
      publish(formatSpec(machine));
      return;
    }

    case "spec-show":
    case "plan-show":
      publish(formatSpec(machine));
      return;

    case "spec-done":
    case "plan-done": {
      machine.completePlanItem();
      const next = machine.currentPlanItem();
      publish(
        next
          ? `Spec item completed. Next: ${next} (${machine.planCompleted}/${machine.plan.length})`
          : `All ${machine.plan.length} spec items completed.`
      );
      return;
    }

    case "off":
    case "disengage": {
      // Run post-flight automatically before disengaging via the shared helper.
      // The helper enforces eligibility (spec set + tests actually passing) and
      // never blocks disengagement on failure — gaps just get surfaced so the
      // user/agent can decide whether to re-engage.
      if (config) {
        const { summary } = await maybeRunPostflightOnDisengage(
          machine,
          ctx as ExtensionContext,
          config
        );
        if (summary) {
          publish(summary);
        }
      }

      machine.enabled = false;
      ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
      ctx.ui.notify("TDD disengaged", "info");
      publish("TDD disengaged. Investigation and navigation are unconstrained.");
      return;
    }

    case "on":
    case "engage":
      if (configDisabled) {
        publishDisabled(machine, ctx, publish);
        return;
      }
      machine.enabled = true;
      ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
      ctx.ui.notify("TDD engaged", "info");
      publish(`TDD engaged. Phase: ${machine.phase}.`);
      return;

    case "preflight": {
      if (configDisabled) {
        publishDisabled(machine, ctx, publish);
        return;
      }
      if (!config) {
        publish("Pre-flight requires the full TDD config to access the review model.");
        return;
      }
      const userStory = args.slice(1).join(" ").trim() || undefined;
      try {
        const result = await runPreflight({ spec: machine.plan, userStory }, ctx, config);
        publish(formatPreflightResult(result));
        ctx.ui.notify(
          result.ok ? "TDD pre-flight: OK" : `TDD pre-flight: ${result.issues.length} issue(s)`,
          result.ok ? "info" : "warning"
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        publish(`Pre-flight failed: ${reason}`);
        ctx.ui.notify(`Pre-flight failed: ${reason}`, "warning");
      }
      return;
    }

    case "postflight": {
      if (configDisabled) {
        publishDisabled(machine, ctx, publish);
        return;
      }
      if (!config) {
        publish("Post-flight requires the full TDD config to access the review model.");
        return;
      }
      const userStory = args.slice(1).join(" ").trim() || undefined;
      try {
        const result = await runPostflight({ state: machine.getSnapshot(), userStory }, ctx, config);
        publish(formatPostflightResult(result));
        ctx.ui.notify(
          result.ok ? "TDD post-flight: OK" : `TDD post-flight: ${result.gaps.length} gap(s)`,
          result.ok ? "info" : "warning"
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        publish(`Post-flight failed: ${reason}`);
        ctx.ui.notify(`Post-flight failed: ${reason}`, "warning");
      }
      return;
    }

    case "history":
      publish(formatHistory(machine));
      return;

    default:
      publish(HELP_TEXT);
  }
}

function formatStatus(machine: PhaseStateMachine, configDisabled = false): string {
  const snap = machine.getSnapshot();
  const lines = [
    configDisabled ? "[TDD: disabled]" : machine.statusText(),
    "",
    `Phase:      ${snap.phase}`,
    `Enabled:    ${configDisabled ? false : snap.enabled}`,
    `Cycle:      ${snap.cycleCount}`,
    `Test state: ${snap.lastTestFailed === null ? "unknown" : snap.lastTestFailed ? "failing" : "passing"}`,
    `Diffs:      ${snap.diffs.length} accumulated`,
  ];

  if (configDisabled) {
    lines.push("Mode:       disabled by configuration");
  }

  if (snap.plan.length > 0) {
    lines.push(`Spec:       ${snap.planCompleted}/${snap.plan.length} completed`);
  }

  return lines.join("\n");
}

function publishDisabled(
  machine: PhaseStateMachine,
  ctx: ExtensionCommandContext,
  publish: Publish
): void {
  machine.enabled = false;
  ctx.ui.setStatus("tdd-gate", machine.bottomBarText());
  ctx.ui.notify("TDD is disabled by configuration", "warning");
  publish("TDD is disabled by configuration.");
}

function formatSpec(machine: PhaseStateMachine): string {
  const snap = machine.getSnapshot();
  if (snap.plan.length === 0) {
    return 'No feature spec set. Use /tdd spec-set "Criterion 1" "Criterion 2" ... to create one.';
  }

  const lines = [`Feature spec (${snap.planCompleted}/${snap.plan.length} completed):`, ""];
  for (let i = 0; i < snap.plan.length; i++) {
    const marker = i < snap.planCompleted ? "[x]" : i === snap.planCompleted ? "[>]" : "[ ]";
    lines.push(`${marker} ${i + 1}. ${snap.plan[i]}`);
  }
  return lines.join("\n");
}

function formatHistory(machine: PhaseStateMachine): string {
  const history = machine.getHistory();
  if (history.length === 0) {
    return "No phase transitions recorded yet.";
  }

  const lines = ["Phase transition history:", ""];
  for (const entry of history) {
    const ts = new Date(entry.timestamp).toLocaleTimeString();
    const override = entry.override ? " [OVERRIDE]" : "";
    lines.push(`${ts} ${entry.from} -> ${entry.to}${override}: ${entry.reason}`);
  }
  return lines.join("\n");
}

export function splitCommandArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const ch of raw.trim()) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

const HELP_TEXT = `Usage: /tdd [subcommand]

/tdd status
/tdd spec        (engages and switches to SPEC)
/tdd red         (engages and switches to RED)
/tdd green       (engages and switches to GREEN)
/tdd refactor    (engages and switches to REFACTOR)
/tdd spec-set "Criterion 1" "Criterion 2"
/tdd spec-show
/tdd spec-done
/tdd preflight   (priming: validate the spec before starting RED)
/tdd postflight  (proving: validate a completed cycle once tests are green)
/tdd engage      (alias /tdd on)
/tdd disengage   (alias /tdd off)
/tdd history`;
