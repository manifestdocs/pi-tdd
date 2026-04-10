export type TDDPhase = "SPEC" | "RED" | "GREEN" | "REFACTOR";
export type TestProofLevel = "unit" | "integration" | "unknown";

export interface TestSignal {
  command: string;
  output: string;
  failed: boolean;
  level: TestProofLevel;
}

export interface PhaseState {
  phase: TDDPhase;
  diffs: string[];
  lastTestOutput: string | null;
  lastTestFailed: boolean | null;
  recentTests: TestSignal[];
  cycleCount: number;
  enabled: boolean;
  plan: string[];
  planCompleted: number;
}

export interface PhaseTransitionLog {
  from: TDDPhase;
  to: TDDPhase;
  reason: string;
  timestamp: number;
  override: boolean;
}

export interface GuidelinesConfig {
  spec: string | null;
  red: string | null;
  green: string | null;
  refactor: string | null;
  universal: string | null;
  security: string | null;
}

export interface ReviewModelRef {
  provider: string;
  model: string;
}

export interface ReviewModels {
  preflight?: ReviewModelRef;
  postflight?: ReviewModelRef;
}

export interface TDDConfig {
  enabled: boolean;
  reviewModel: string | null;
  reviewProvider: string | null;
  reviewModels: ReviewModels;
  autoTransition: boolean;
  refactorTransition: "user" | "agent" | "timeout";
  allowReadInAllPhases: boolean;
  temperature: number;
  maxDiffsInContext: number;
  persistPhase: boolean;
  startInSpecMode: boolean;
  /**
   * If true, every fresh session starts with TDD engaged (legacy behavior).
   * If false (default), sessions start dormant — TDD only engages when the
   * agent calls tdd_engage, when a configured lifecycle hook fires, or when
   * the user runs an explicit /tdd phase command.
   */
  defaultEngaged: boolean;
  /**
   * If true (default), transitioning out of SPEC into RED automatically fires
   * the preflight check first. If preflight finds issues, the transition is
   * blocked (or warned, depending on the dialog response) so the spec gets
   * tightened before the cycle starts.
   */
  runPreflightOnRed: boolean;
  /**
   * Tool names that auto-engage TDD when called. Useful for hooking task or
   * feature management tools (e.g., manifest's start_feature) into the TDD
   * lifecycle without requiring the agent to remember tdd_engage.
   */
  engageOnTools: string[];
  /**
   * Tool names that auto-disengage TDD when called. Pair with engageOnTools to
   * close out a feature lifecycle (e.g., manifest's complete_feature).
   */
  disengageOnTools: string[];
  guidelines: GuidelinesConfig;
}
