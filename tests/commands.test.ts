import { describe, expect, it, vi } from "vitest";
import { handleTddCommand, splitCommandArgs } from "../src/commands.ts";
import { PhaseStateMachine } from "../src/phase.ts";
import { resolveGuidelines } from "../src/guidelines.ts";
import type { TDDConfig } from "../src/types.ts";

function createCommandContext() {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  } as never;
}

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

describe("splitCommandArgs", () => {
  it("handles quoted and unquoted segments", () => {
    expect(splitCommandArgs('"a b" c')).toEqual(["a b", "c"]);
  });

  it("handles escaped spaces", () => {
    expect(splitCommandArgs(String.raw`a\ b c`)).toEqual(["a b", "c"]);
  });
});

describe("handleTddCommand", () => {
  it("does not mark a normal SPEC to RED transition as an override", async () => {
    const machine = new PhaseStateMachine({ phase: "SPEC", plan: ["first criterion"] });
    const publish = vi.fn();

    await handleTddCommand(
      "red",
      machine,
      createCommandContext(),
      publish,
      makeConfig({ runPreflightOnRed: false })
    );

    expect(machine.getHistory()).toHaveLength(1);
    expect(machine.getHistory()[0]?.override).toBe(false);
  });

  it("marks a non-sequential phase jump as an override", async () => {
    const machine = new PhaseStateMachine({ phase: "SPEC" });
    const publish = vi.fn();

    await handleTddCommand("green", machine, createCommandContext(), publish);

    expect(machine.getHistory()).toHaveLength(1);
    expect(machine.getHistory()[0]?.override).toBe(true);
  });

  it("blocks dormant entry into RED when preflight fails", async () => {
    const machine = new PhaseStateMachine();
    const publish = vi.fn();

    await handleTddCommand("red", machine, createCommandContext(), publish, makeConfig());

    expect(machine.enabled).toBe(false);
    expect(machine.getHistory()).toHaveLength(0);
    expect(publish).toHaveBeenCalledWith(expect.stringContaining("Pre-flight found 1 issue(s)"));
  });
});
