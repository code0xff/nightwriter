import {
  GENERATOR_CLIS,
  type GenerateRequest,
  TARGETS,
} from "@nightwriter/shared";

export class ValidationError extends Error {}

const MAX_PROMPT_LEN = 20_000;
const MODEL_RE = /^[A-Za-z0-9._:\-/]{1,80}$/;

/** Validate and normalize an untrusted POST /api/generate body. */
export function parseGenerateRequest(body: unknown): GenerateRequest {
  if (typeof body !== "object" || body === null)
    throw new ValidationError("body must be a JSON object");
  const b = body as Record<string, unknown>;

  const prompt = b.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0)
    throw new ValidationError("prompt is required");
  if (prompt.length > MAX_PROMPT_LEN)
    throw new ValidationError(`prompt exceeds ${MAX_PROMPT_LEN} characters`);

  const generator = b.generator;
  if (typeof generator !== "object" || generator === null)
    throw new ValidationError("generator is required");
  const g = generator as Record<string, unknown>;
  if (!GENERATOR_CLIS.includes(g.cli as never))
    throw new ValidationError(
      `generator.cli must be one of: ${GENERATOR_CLIS.join(", ")}`,
    );
  let model: string | undefined;
  if (g.model !== undefined && g.model !== null) {
    if (typeof g.model !== "string" || !MODEL_RE.test(g.model))
      throw new ValidationError("generator.model is invalid");
    model = g.model;
  }

  if (!TARGETS.includes(b.target as never))
    throw new ValidationError(`target must be one of: ${TARGETS.join(", ")}`);

  return {
    prompt: prompt.trim(),
    generator: { cli: g.cli as GenerateRequest["generator"]["cli"], model },
    target: b.target as GenerateRequest["target"],
  };
}
