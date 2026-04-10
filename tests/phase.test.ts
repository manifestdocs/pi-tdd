import { describe, expect, it } from "vitest";
import { PhaseStateMachine } from "../src/phase.ts";

describe("PhaseStateMachine", () => {
  it("increments cycleCount only on REFACTOR to RED", () => {
    const machine = new PhaseStateMachine({ phase: "REFACTOR", cycleCount: 2 });

    machine.transitionTo("RED", "next slice");
    expect(machine.cycleCount).toBe(3);

    machine.transitionTo("GREEN", "manual");
    expect(machine.cycleCount).toBe(3);
  });

  it("reports SPEC as the next phase target for RED only through the cycle start", () => {
    const machine = new PhaseStateMachine({ phase: "SPEC" });
    expect(machine.nextPhase()).toBe("RED");
  });

  it("tracks recent test evidence and clears it when a new RED cycle starts", () => {
    const machine = new PhaseStateMachine({ phase: "GREEN" });

    machine.recordTestResult("1 failed", true, "npm run test:unit", "unit");
    machine.recordTestResult("1 passed", false, "npm run test:integration", "integration");

    expect(machine.getSnapshot().recentTests).toEqual([
      {
        command: "npm run test:unit",
        output: "1 failed",
        failed: true,
        level: "unit",
      },
      {
        command: "npm run test:integration",
        output: "1 passed",
        failed: false,
        level: "integration",
      },
    ]);

    machine.transitionTo("REFACTOR", "green reached");
    machine.transitionTo("RED", "next slice");

    expect(machine.lastTestFailed).toBeNull();
    expect(machine.lastTestOutput).toBeNull();
    expect(machine.getSnapshot().recentTests).toEqual([]);
  });
});
