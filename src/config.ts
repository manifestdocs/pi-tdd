import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GuidelinesConfig, ReviewModels, TDDConfig } from "./types.js";
import { resolveGuidelines } from "./guidelines.js";

const DEFAULTS: Omit<TDDConfig, "guidelines"> = {
  enabled: true,
  reviewModel: null,
  reviewProvider: null,
  reviewModels: {},
  autoTransition: true,
  refactorTransition: "user",
  allowReadInAllPhases: true,
  temperature: 0,
  maxDiffsInContext: 5,
  persistPhase: true,
  startInSpecMode: false,
  defaultEngaged: false,
  runPreflightOnRed: true,
  engageOnTools: [],
  disengageOnTools: [],
};

type UserConfig = Partial<Omit<TDDConfig, "guidelines">> & {
  startInPlanMode?: boolean;
  /** Deprecated alias for reviewProvider. */
  judgeProvider?: string | null;
  /** Deprecated alias for reviewModel. */
  judgeModel?: string | null;
  guidelines?: Partial<GuidelinesConfig> & { plan?: string | null };
};

interface SettingsFileShape {
  tddGate?: UserConfig;
}

function readJSON(path: string): SettingsFileShape | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as SettingsFileShape;
  } catch (error) {
    console.error(`[tdd-gate] Failed to parse settings file ${path}:`, error);
    return undefined;
  }
}

function mergeGuidelines(
  base: Partial<GuidelinesConfig> | undefined,
  next: Partial<GuidelinesConfig> | undefined
): Partial<GuidelinesConfig> | undefined {
  if (!base && !next) return undefined;
  return { ...(base ?? {}), ...(next ?? {}) };
}

function mergeReviewModels(
  base: Partial<ReviewModels> | undefined,
  next: Partial<ReviewModels> | undefined
): Partial<ReviewModels> | undefined {
  if (!base && !next) return undefined;
  return { ...(base ?? {}), ...(next ?? {}) };
}

function mergeConfigLayers(
  base: UserConfig | undefined,
  next: UserConfig | undefined
): UserConfig {
  if (!base && !next) return {};
  const merged = { ...(base ?? {}), ...(next ?? {}) };
  merged.guidelines = mergeGuidelines(base?.guidelines, next?.guidelines);
  merged.reviewModels = mergeReviewModels(base?.reviewModels, next?.reviewModels);
  return merged;
}

export function loadConfig(cwd: string): TDDConfig {
  const globalSettings = readJSON(join(homedir(), ".pi", "agent", "settings.json"));
  const projectSettings = readJSON(join(cwd, ".pi", "settings.json"));

  const user = mergeConfigLayers(globalSettings?.tddGate, projectSettings?.tddGate);
  const guidelines = resolveGuidelines(user.guidelines);
  const startInSpecMode = user.startInSpecMode ?? user.startInPlanMode;
  const reviewProvider = user.reviewProvider ?? user.judgeProvider;
  const reviewModel = user.reviewModel ?? user.judgeModel;
  const {
    guidelines: _ignoredGuidelines,
    startInPlanMode: _ignoredStartInPlanMode,
    judgeProvider: _ignoredJudgeProvider,
    judgeModel: _ignoredJudgeModel,
    ...rest
  } = user;

  return {
    ...DEFAULTS,
    ...(rest as Partial<TDDConfig>),
    startInSpecMode: startInSpecMode ?? DEFAULTS.startInSpecMode,
    reviewProvider: reviewProvider ?? DEFAULTS.reviewProvider,
    reviewModel: reviewModel ?? DEFAULTS.reviewModel,
    guidelines,
  };
}

export { DEFAULTS };
