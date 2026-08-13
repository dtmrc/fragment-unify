import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * The task explicitly pins this model. `claude-sonnet-5` is a current model ID;
 * it supports structured outputs (`output_config.format`), which is what makes
 * every pipeline response schema-validated rather than free-text-parsed.
 */
export const MODEL = "claude-sonnet-5";

/** Thrown when a Claude-dependent path runs without a key. Never silently mocked. */
export class MissingApiKeyError extends Error {
  constructor() {
    super("set ANTHROPIC_API_KEY to run the pipeline");
    this.name = "MissingApiKeyError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!hasApiKey()) throw new MissingApiKeyError();
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Single choke point for every Claude call in the app.
 *
 * Uses the SDK's `messages.parse` with a Zod-derived JSON schema so the model's
 * output is *validated against the schema* — `parsed_output` is either a
 * correctly-typed object or we throw. Thinking is disabled to keep the
 * extraction stages fast, cheap, and deterministic-leaning (a defensible choice
 * for structured extraction; flip to adaptive if you want the model to reason
 * harder on ambiguous merges).
 */
export async function callStructured<S extends z.ZodType>(
  schema: S,
  opts: { system: string; user: string; maxTokens?: number },
): Promise<z.infer<S>> {
  const anthropic = getClient();
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    thinking: { type: "disabled" },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.parsed_output == null) {
    throw new Error(
      `Claude returned no schema-valid output (stop_reason=${response.stop_reason})`,
    );
  }
  return response.parsed_output;
}
