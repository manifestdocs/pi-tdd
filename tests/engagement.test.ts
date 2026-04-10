import { describe, expect, it, vi } from "vitest";
import { PhaseStateMachine } from "../src/phase.ts";
import {
  applyLifecycleHooks,
  createDisengageTool,
  createEngageTool,
  DISENGAGE_TOOL_NAME,
  ENGAGE_TOOL_NAME,
  type EngagementDeps,
} from "../src/engagement.ts";
import { handleTddCommand } from "../src/commands.ts";
import { buildSystemPrompt } from "../src/system-prompt.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

function makeConfig(overrides: Partial<TDDConfig> = {}): TDDConfig {
  return {
    enabled: true,
    reviewModel: null,
    reviewProvider: null,
    reviewModels: {},
    autoTransition: true,
    refactorTransition: "user",
    allowReadInAllPhases: true,
    temperature: 0,
    maxDiffsInContext: 5,
    persistPhase: false,
    startInSpecMode: false,
    defaultEngaged: false,
    runPreflightOnRed: true,
    engageOnTools: [],
    disengageOnTools: [],
    guidelines: resolveGuidelines({}),
    ...overrides,
  };
}

function makeContext() {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    hasUI: false,
  } as never;
}

function makeDeps(machine: PhaseStateMachine, config: TDDConfig): EngagementDeps {
  return {
    pi: { appendEntry: vi.fn() } as never,
    machine,
    getConfig: () => config,
  };
}

describe("PhaseStateMachine defaults", () => {
  it("defaults to dormant (enabled=false) on a fresh machine", () => {
    const machine = new PhaseStateMachine();
    expect(machine.enabled).toBe(false);
  });

  it("status text reports dormant when not engaged", () => {
    const machine = new PhaseStateMachine();
    expect(machine.statusText()).toBe("[TDD: dormant]");
  });

  it("bottom-bar text is hidden (undefined) when dormant", () => {
    const machine = new PhaseStateMachine();
    expect(machine.bottomBarText()).toBeUndefined();
  });

  it("bottom-bar text matches statusText when engaged", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });
    expect(machine.bottomBarText()).toBe(machine.statusText());
  });
});

describe("applyLifecycleHooks", () => {
  it("treats tdd_engage as a control tool", async () => {
    const machine = new PhaseStateMachine();
    const result = await applyLifecycleHooks(
      ENGAGE_TOOL_NAME,
      makeDeps(machine, makeConfig()),
      makeContext()
    );
    expect(result.isControlTool).toBe(true);
    expect(machine.enabled).toBe(false);
  });

  it("treats tdd_disengage as a control tool", async () => {
    const machine = new PhaseStateMachine({ enabled: true });
    const result = await applyLifecycleHooks(
      DISENGAGE_TOOL_NAME,
      makeDeps(machine, makeConfig()),
      makeContext()
    );
    expect(result.isControlTool).toBe(true);
    expect(machine.enabled).toBe(true);
  });

  it("engages TDD when a configured engageOnTools tool is called", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      engageOnTools: ["mcp__manifest__start_feature"],
      runPreflightOnRed: false,
    });
    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext()
    );
    expect(result.engaged).toBe(true);
    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
  });

  it("blocks auto-engage into RED when preflight fails", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({ engageOnTools: ["mcp__manifest__start_feature"] });
    const result = await applyLifecycleHooks(
      "mcp__manifest__start_feature",
      makeDeps(machine, config),
      makeContext()
    );

    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
    expect(machine.getHistory()).toHaveLength(0);
  });

  it("uses SPEC when startInSpecMode is true", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      engageOnTools: ["start_feature"],
      startInSpecMode: true,
    });
    await applyLifecycleHooks("start_feature", makeDeps(machine, config), makeContext());
    expect(machine.phase).toBe("SPEC");
  });

  it("disengages TDD when a configured disengageOnTools tool is called", async () => {
    // No spec set + lastTestFailed=null, so postflight is NOT eligible and the
    // helper short-circuits without touching the LLM. This test stays a pure
    // unit test of the lifecycle hook itself.
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const config = makeConfig({ disengageOnTools: ["mcp__manifest__complete_feature"] });
    const result = await applyLifecycleHooks(
      "mcp__manifest__complete_feature",
      makeDeps(machine, config),
      makeContext()
    );
    expect(result.disengaged).toBe(true);
    expect(machine.enabled).toBe(false);
  });

  it("is a no-op for tools not in any hook list", async () => {
    const machine = new PhaseStateMachine();
    const result = await applyLifecycleHooks("bash", makeDeps(machine, makeConfig()), makeContext());
    expect(result.isControlTool).toBe(false);
    expect(result.engaged).toBeUndefined();
    expect(result.disengaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });

  it("does not re-engage when machine is already engaged", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "REFACTOR" });
    const config = makeConfig({ engageOnTools: ["start_feature"] });
    const result = await applyLifecycleHooks("start_feature", makeDeps(machine, config), makeContext());
    expect(result.engaged).toBeUndefined();
    expect(machine.phase).toBe("REFACTOR");
  });

  it("does not auto-engage when config disables TDD", async () => {
    const machine = new PhaseStateMachine();
    const config = makeConfig({
      enabled: false,
      engageOnTools: ["start_feature"],
    });
    const result = await applyLifecycleHooks("start_feature", makeDeps(machine, config), makeContext());
    expect(result.engaged).toBeUndefined();
    expect(machine.enabled).toBe(false);
  });
});

describe("createEngageTool", () => {
  it("engages a dormant machine and transitions to SPEC by default", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-1",
      { reason: "implementing checkout validation" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("SPEC");
    expect(result.details).toMatchObject({ engaged: true, phase: "SPEC" });
  });

  it("honours an explicit RED phase", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig({ runPreflightOnRed: false })));

    await tool.execute(
      "call-2",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
  });

  it("blocks direct RED engagement when preflight fails", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-2b",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(machine.getHistory()).toHaveLength(0);
    expect(result.details).toMatchObject({ engaged: false, phase: "RED" });
    expect(result.content[0]?.text).toContain("Engagement into RED is blocked");
  });

  it("does not engage when config disables TDD", async () => {
    const machine = new PhaseStateMachine();
    const tool = createEngageTool(makeDeps(machine, makeConfig({ enabled: false })));

    const result = await tool.execute(
      "call-3",
      { phase: "RED", reason: "fix off-by-one in pagination" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(result.details).toMatchObject({ engaged: false, phase: null });
  });
});

describe("createDisengageTool", () => {
  it("disengages an engaged machine", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "GREEN" });
    const tool = createDisengageTool(makeDeps(machine, makeConfig()));

    const result = await tool.execute(
      "call-3",
      { reason: "feature complete" },
      undefined,
      undefined,
      makeContext()
    );

    expect(machine.enabled).toBe(false);
    expect(result.details).toMatchObject({ engaged: false });
  });
});

describe("/tdd phase commands engage when dormant", () => {
  it("/tdd red engages a dormant machine", async () => {
    const machine = new PhaseStateMachine();
    expect(machine.enabled).toBe(false);

    await handleTddCommand(
      "red",
      machine,
      makeContext(),
      vi.fn(),
      makeConfig({ runPreflightOnRed: false })
    );

    expect(machine.enabled).toBe(true);
    expect(machine.phase).toBe("RED");
  });

  it("/tdd disengage turns off an engaged machine", async () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });

    await handleTddCommand("disengage", machine, makeContext(), vi.fn());

    expect(machine.enabled).toBe(false);
  });

  it("/tdd red stays disabled when config disables TDD", async () => {
    const machine = new PhaseStateMachine();
    const publish = vi.fn();

    await handleTddCommand("red", machine, makeContext(), publish, makeConfig({ enabled: false }));

    expect(machine.enabled).toBe(false);
    expect(machine.phase).toBe("RED");
    expect(publish).toHaveBeenCalledWith("TDD is disabled by configuration.");
  });
});

describe("buildSystemPrompt for dormant state", () => {
  it("returns the dormant prompt when machine is dormant and config is enabled", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(machine, makeConfig());
    expect(prompt).toContain("[TDD MODE - dormant]");
    expect(prompt).toContain("tdd_engage");
  });

  it("returns the disabled prompt when config disables TDD entirely", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(machine, makeConfig({ enabled: false }));
    expect(prompt).toContain("[TDD MODE - DISABLED]");
  });

  it("lists configured engageOnTools in the dormant prompt", () => {
    const machine = new PhaseStateMachine();
    const prompt = buildSystemPrompt(
      machine,
      makeConfig({ engageOnTools: ["mcp__manifest__start_feature"] })
    );
    expect(prompt).toContain("mcp__manifest__start_feature");
  });

  it("returns the engaged phase prompt once TDD is engaged", () => {
    const machine = new PhaseStateMachine({ enabled: true, phase: "RED" });
    const prompt = buildSystemPrompt(machine, makeConfig());
    expect(prompt).toContain("[TDD MODE - Phase: RED]");
  });
});
