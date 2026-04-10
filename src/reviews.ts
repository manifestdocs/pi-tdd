import { complete, type Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ReviewModels, TDDConfig } from "./types.js";

/**
 * Shared infrastructure for the two review steps that bookend a TDD cycle:
 *
 *   - Preflight (priming):  validates the spec checklist before RED starts.
 *   - Postflight (proving): validates the delivered cycle once tests are green.
 *
 * Both reviews are LLM calls — but they fire only at cycle boundaries, never
 * during the RED → GREEN → REFACTOR loop. The loop itself runs unimpeded with
 * no per-tool-call gating.
 */

export interface ReviewRequest {
  /** Short human-readable label for diagnostics ("preflight" / "postflight"). */
  label: string;
  /** System prompt sent as the request "instructions" field. CRITICAL: must
   *  be non-empty so providers like the OpenAI Responses API don't reject the
   *  request with `{"detail":"Instructions are required"}`. */
  systemPrompt: string;
  /** User-message prompt body. */
  userPrompt: string;
}

export interface RawReviewResponse {
  text: string;
}

export async function runReview(
  request: ReviewRequest,
  ctx: ExtensionContext,
  config: TDDConfig
): Promise<RawReviewResponse> {
  const model = resolveReviewModel(ctx, config, request.label as ReviewLabel);
  if (!model) {
    throw new Error("No review model available");
  }

  const auth = await resolveReviewAuth(ctx, model);

  const response = await complete(
    model,
    reviewRequestBody(request),
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: ctx.signal,
      temperature: config.temperature,
    }
  );

  if (response.stopReason === "aborted") {
    throw new Error(`${request.label} request aborted`);
  }
  if (response.stopReason === "error") {
    throw new Error(response.errorMessage ?? `${request.label} request failed`);
  }

  const text = responseText(response.content);
  if (!text) {
    throw new Error(`${request.label} returned no text`);
  }

  return { text };
}

export type ReviewLabel = keyof ReviewModels;

export function resolveReviewModel(
  ctx: ExtensionContext,
  config: TDDConfig,
  label?: ReviewLabel
): Model | undefined {
  // Per-review override (e.g. reviewModels.preflight)
  if (label) {
    const ref = config.reviewModels[label];
    if (ref) {
      return ctx.modelRegistry.find(ref.provider, ref.model);
    }
  }

  // Top-level fallback
  if (config.reviewProvider && config.reviewModel) {
    return ctx.modelRegistry.find(config.reviewProvider, config.reviewModel);
  }

  // Session active model
  return ctx.model;
}

export function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw.trim();
}

async function resolveReviewAuth(ctx: ExtensionContext, model: Model) {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key configured for ${model.provider}/${model.id}`);
  }
  return auth;
}

function reviewRequestBody(request: ReviewRequest) {
  return {
    systemPrompt: request.systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: request.userPrompt }],
        timestamp: Date.now(),
      },
    ],
  };
}

function responseText(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && !!item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();
}
