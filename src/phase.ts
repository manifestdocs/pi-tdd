import type { PhaseState, PhaseTransitionLog, TDDPhase } from "./types.js";

const CYCLE_ORDER: TDDPhase[] = ["RED", "GREEN", "REFACTOR"];

export class PhaseStateMachine {
  // "plan" is the persisted historical field name for the SPEC checklist.
  private state: PhaseState;
  private history: PhaseTransitionLog[] = [];

  constructor(initial?: Partial<PhaseState>) {
    this.state = {
      phase: initial?.phase ?? "RED",
      diffs: initial?.diffs ?? [],
      lastTestOutput: initial?.lastTestOutput ?? null,
      lastTestFailed: initial?.lastTestFailed ?? null,
      cycleCount: initial?.cycleCount ?? 0,
      enabled: initial?.enabled ?? false,
      plan: initial?.plan ?? [],
      planCompleted: initial?.planCompleted ?? 0,
    };
  }

  get phase(): TDDPhase {
    return this.state.phase;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  set enabled(value: boolean) {
    this.state.enabled = value;
  }

  get cycleCount(): number {
    return this.state.cycleCount;
  }

  get lastTestFailed(): boolean | null {
    return this.state.lastTestFailed;
  }

  get lastTestOutput(): string | null {
    return this.state.lastTestOutput;
  }

  get diffs(): string[] {
    return this.state.diffs;
  }

  get plan(): string[] {
    return this.state.plan;
  }

  get planCompleted(): number {
    return this.state.planCompleted;
  }

  getSnapshot(): Readonly<PhaseState> {
    return {
      ...this.state,
      diffs: [...this.state.diffs],
      plan: [...this.state.plan],
    };
  }

  restore(state: PhaseState): void {
    this.state = {
      phase: state.phase,
      diffs: [...state.diffs],
      lastTestOutput: state.lastTestOutput,
      lastTestFailed: state.lastTestFailed,
      cycleCount: state.cycleCount,
      enabled: state.enabled,
      plan: [...state.plan],
      planCompleted: state.planCompleted,
    };
  }

  getHistory(): readonly PhaseTransitionLog[] {
    return this.history;
  }

  nextPhase(): TDDPhase {
    if (this.state.phase === "SPEC") {
      return "RED";
    }

    const idx = CYCLE_ORDER.indexOf(this.state.phase);
    return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
  }

  transitionTo(target: TDDPhase, reason: string, override = false): boolean {
    if (target === this.state.phase) return false;

    const log: PhaseTransitionLog = {
      from: this.state.phase,
      to: target,
      reason,
      timestamp: Date.now(),
      override,
    };

    this.history.push(log);

    if (this.state.phase === "REFACTOR" && target === "RED") {
      this.state.cycleCount++;
    }

    this.state.phase = target;
    this.state.diffs = [];
    return true;
  }

  setPlan(items: string[]): void {
    this.state.plan = items;
    this.state.planCompleted = 0;
  }

  completePlanItem(): void {
    if (this.state.planCompleted < this.state.plan.length) {
      this.state.planCompleted++;
    }
  }

  currentPlanItem(): string | null {
    if (this.state.planCompleted < this.state.plan.length) {
      return this.state.plan[this.state.planCompleted];
    }

    return null;
  }

  addDiff(summary: string, maxDiffs: number): void {
    this.state.diffs.push(summary);
    if (this.state.diffs.length > maxDiffs) {
      this.state.diffs = this.state.diffs.slice(-maxDiffs);
    }
  }

  recordTestResult(output: string, failed: boolean): void {
    this.state.lastTestOutput = output;
    this.state.lastTestFailed = failed;
  }

  allowedActions(): string {
    switch (this.state.phase) {
      case "SPEC":
        return "Read code. Clarify the user's request. Translate it into user-visible behavior, acceptance criteria, and testable specifications. Discuss the spec.";
      case "RED":
        return "Write or modify tests. Run tests to confirm failure. Read any file.";
      case "GREEN":
        return "Write the minimum implementation to pass the failing test. Run tests.";
      case "REFACTOR":
        return "Restructure, rename, extract. Run tests to confirm behavior stays the same.";
    }
  }

  prohibitedActions(): string {
    switch (this.state.phase) {
      case "SPEC":
        return "Write or modify files. Execute state-changing commands. Implementation planning and code changes are out of scope. Only request-to-spec translation work is allowed.";
      case "RED":
        return "Write production implementation. Modify non-test source files unless explicitly overridden.";
      case "GREEN":
        return "Refactor. Add features beyond what the failing test requires.";
      case "REFACTOR":
        return "Change behavior. Add new tests for new scope.";
    }
  }

  statusText(): string {
    if (!this.state.enabled) {
      return "[TDD: dormant]";
    }

    if (this.state.phase === "SPEC") {
      return `[TDD: SPEC] | Spec items: ${this.state.plan.length}`;
    }

    const testStatus =
      this.state.lastTestFailed === null ? "UNKNOWN" : this.state.lastTestFailed ? "FAILING" : "PASSING";
    const planProgress =
      this.state.plan.length > 0 ? ` | Spec: ${this.state.planCompleted}/${this.state.plan.length}` : "";
    return `[TDD: ${this.state.phase}] | Tests: ${testStatus} | Cycle: ${this.state.cycleCount}${planProgress}`;
  }

  /**
   * Status text for the Pi bottom-bar indicator. Returns undefined when TDD is
   * dormant so the indicator disappears entirely — there's nothing useful to
   * communicate while TDD is not enforcing anything.
   */
  bottomBarText(): string | undefined {
    return this.state.enabled ? this.statusText() : undefined;
  }
}
