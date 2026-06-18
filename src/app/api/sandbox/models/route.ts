import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const base = (process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
  try {
    const res  = await fetch(`${base}/api/tags`, { cache: 'no-store' });
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ models: [], error: String(err) });
  }
}
