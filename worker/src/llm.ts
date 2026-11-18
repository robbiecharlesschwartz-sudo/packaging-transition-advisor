import type { Env } from './env';
import { extractJson } from './util';

export interface LlmResult<T> {
  data: T;
  provider: string;
  model: string;
}

export interface LlmCall {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

class RetryableError extends Error {}

async function gemini(env: Env, model: string, c: LlmCall, thinking = true): Promise<string> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: c.system }] },
    contents: [{ role: 'user', parts: [{ text: c.user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: c.temperature ?? 0.2,
      maxOutputTokens: Math.max(c.maxTokens ?? 8192, 4096) * 2,
      ...(!thinking ? {} : model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { thinkingLevel: 'low' } }),
    },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  if (r.status === 429 || r.status === 404 || r.status >= 500) {
    throw new RetryableError(`gemini ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 400 && thinking && /thinking/i.test(t)) return gemini(env, model, c, false);
    throw new Error(`gemini ${model} HTTP ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = (await r.json()) as any;
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  if (!text) throw new RetryableError(`gemini ${model}: empty response (${j.candidates?.[0]?.finishReason ?? 'n/a'})`);
  return text;
}

async function anthropic(env: Env, c: LlmCall): Promise<string> {
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: c.maxTokens ?? 8192,
      temperature: c.temperature ?? 0.2,
      system: c.system + '\nRespond with a single JSON object and nothing else.',
      messages: [{ role: 'user', content: c.user }],
    }),
  });
  if (r.status === 429 || r.status >= 500) throw new RetryableError(`anthropic HTTP ${r.status}`);
  if (!r.ok) throw new Error(`anthropic HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as any;
  return j.content?.map((b: any) => b.text ?? '').join('') ?? '';
}

async function workersAi(env: Env, c: LlmCall): Promise<string> {
  const res = (await env.AI.run(env.FALLBACK_LLM as any, {
    messages: [
      { role: 'system', content: c.system + '\nRespond with a single JSON object and nothing else.' },
      { role: 'user', content: c.user },
    ],
    max_tokens: Math.min(c.maxTokens ?? 4096, 4096),
    temperature: c.temperature ?? 0.2,
  })) as any;
  const out = res.response;
  return typeof out === 'string' ? out : JSON.stringify(out);
}

/** Calls the configured provider and parses JSON. Gemini falls back through GEMINI_FALLBACK_MODELS,
 * then to Workers AI, so a rate-limited free tier degrades instead of failing the run. */
export async function llmJson<T>(env: Env, c: LlmCall): Promise<LlmResult<T>> {
  const errors: string[] = [];
  const tryParse = (text: string, provider: string, model: string): LlmResult<T> => ({
    data: extractJson<T>(text),
    provider,
    model,
  });

  if (env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    try {
      return tryParse(await anthropic(env, c), 'anthropic', env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (env.GEMINI_API_KEY) {
    const models = [env.GEMINI_MODEL, ...(env.GEMINI_FALLBACK_MODELS || '').split(',')]
      .map((m) => m.trim())
      .filter(Boolean);
    for (const m of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return tryParse(await gemini(env, m, c), 'gemini', m);
        } catch (e) {
          errors.push(String(e));
          if (!(e instanceof RetryableError) && !(e instanceof SyntaxError) && !String(e).includes('valid JSON')) break;
          if (String(e).includes('HTTP 404')) break;
          if (String(e).includes('HTTP 429')) await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        }
      }
    }
  }
  try {
    return tryParse(await workersAi(env, c), 'workers-ai', env.FALLBACK_LLM);
  } catch (e) {
    errors.push(String(e));
  }
  throw new Error('All LLM providers failed: ' + errors.join(' | ').slice(0, 900));
}

export async function listGeminiModels(env: Env): Promise<string[]> {
  if (!env.GEMINI_API_KEY) return [];
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
  });
  const j = (await r.json()) as any;
  if (!r.ok) return [`ERROR HTTP ${r.status}: ${JSON.stringify(j?.error?.message ?? j).slice(0, 300)}`];
  return (j.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: any) => String(m.name).replace('models/', ''));
}
