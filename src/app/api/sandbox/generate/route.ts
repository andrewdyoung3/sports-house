import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { prompt, model, system, maxTokens } = await req.json() as {
    prompt: string; model: string; system?: string; maxTokens?: number;
  };
  if (!prompt || !model) {
    return NextResponse.json({ error: 'prompt and model required' }, { status: 400 });
  }
  // Default 8000: the thinking model emits a reasoning block BEFORE the JSON answer,
  // so the cap must cover reasoning + answer or the JSON truncates and fails to parse.
  const cap = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 8000;

  const base = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  const t0 = Date.now();
  try {
    const { SYSTEM_PROMPT } = await import('@/lib/preview-prompt');
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama', timeout: 15 * 60 * 1000 });

    // Sandbox-only: caller may override the system message to experiment with the
    // instruction layer. Falls back to the canonical production system prompt.
    const systemMessage = typeof system === 'string' && system.length > 0 ? system : SYSTEM_PROMPT;

    const response = await client.chat.completions.create({
      model,
      max_tokens: cap,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user',   content: prompt },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';

    // Extract think block if present
    let thinkBlock: string | undefined;
    let cleaned = raw;
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>\s*/i);
    if (thinkMatch) {
      thinkBlock = thinkMatch[1].trim();
      cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/i, '').trim();
    }

    // Strip markdown fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd   = cleaned.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try { parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)); } catch { /* */ }
      }
    }

    return NextResponse.json({ parsed, raw, thinkBlock, ms: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json({ error: String(err), ms: Date.now() - t0 }, { status: 500 });
  }
}
