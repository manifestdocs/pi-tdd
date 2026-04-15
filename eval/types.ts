// Trial/variant config is owned by the eval consumer, not the framework

export interface TestStack {
  language: string;
  testFramework: string;
  /** Which part of the trial this stack applies to, e.g. "backend", "frontend" */
  scope?: string;
  /** Extra instructions for the agent, e.g. "Create a pyproject.toml." */
  setup?: string;
}

export interface VariantConfig {
  /** Single-package trials: one stack. Monorepos: one stack per package. */
  stacks: TestStack[] | TestStack;
}

export interface TrialConfig {
  name: string;
  description: string;
  prdFile: string;
  taskCount: number;
  scaffoldDir?: string;
  plugin: string;
  features: string[];
  variants: Record<string, VariantConfig>;
}

/** Flatten stacks to an array regardless of single vs multi */
export function getStacks(variant: VariantConfig): TestStack[] {
  return Array.isArray(variant.stacks) ? variant.stacks : [variant.stacks];
}

// -- Eval configuration -------------------------------------------------------

export interface ModelConfig {
  provider?: string;
  model?: string;
  thinking?: string;
}

export interface SuiteEntry {
  trial: string;
  variant: string;
  epochs?: number;
}

export interface EvalConfig {
  worker?: ModelConfig;
  judge?: ModelConfig;
  models?: ModelConfig[];
  timeouts?: {
    workerMs?: number;
    inactivityMs?: number;
    judgeMs?: number;
  };
  execution?: {
    suiteConcurrency?: number;
  };
  /** Run each trial N times for statistical significance (default 1). */
  epochs?: number;
  /** Resource and behavior budgets — violations appear in report findings. */
  budgets?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
    maxDurationMs?: number;
    maxToolCalls?: number;
    maxBlockedCalls?: number;
    maxFileWrites?: number;
  };
  suites?: Record<string, SuiteEntry[]>;
  /** Compatibility alias for older configs. Prefer `suites`. */
  runSets?: Record<string, SuiteEntry[]>;
  regressions?: {
    threshold?: number;
  };
}
