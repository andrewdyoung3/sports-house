/**
 * Production Claude model for the AI preview + review routes.
 *
 * Single source of truth so a model swap — back to Sonnet, or to a future local
 * model (see PROJECT_CONTEXT §10) — is a config change, not a code edit. Override
 * at runtime via the ANTHROPIC_AI_MODEL env var; defaults to Claude Haiku 4.5
 * (chosen for ~3× lower cost and ~2× lower latency vs Sonnet 4.6 — see the
 * scripts/eval-previews.ts comparison).
 */
export const AI_MODEL = process.env.ANTHROPIC_AI_MODEL ?? 'claude-haiku-4-5-20251001';
