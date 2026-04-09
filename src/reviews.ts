import { complete, type Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TDDConfig } from "./types.js";

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
  const model = resolveReviewModel(ctx, config);
  if (!model) {
    throw new Error("No review model available");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  if (!auth.apiKey) {
    throw new Error(`No API key configured for ${model.provider}/${model.id}`);
  }

  const response = await complete(
    model,
    {
      systemPrompt: request.systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: request.userPrompt }],
          timestamp: Date.now(),
        },
      ],
    },
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

  const text = response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error(`${request.label} returned no text`);
  }

  return { text };
}

export function resolveReviewModel(ctx: ExtensionContext, config: TDDConfig): Model | undefined {
  if (config.reviewProvider && config.reviewModel) {
    return ctx.modelRegistry.find(config.reviewProvider, config.reviewModel);
  }
  return ctx.model;
}

export function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : raw.trim();
}
