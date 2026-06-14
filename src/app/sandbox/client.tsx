'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AIPreview } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlockData {
  id: string;
  label: string;
  text: string;
}

interface ContextData {
  gameLabel: string;
  blocks: BlockData[];
  systemPrompt: string;
  footer: string;
}

interface RunResult {
  parsed: AIPreview | null;
  raw?: string | null;
  ms: number;
  error?: string;
  thinkBlock?: string;
}

// ─── PreviewView component ────────────────────────────────────────────────────

function PreviewView({ payload }: { payload: AIPreview }) {
  return (
    <div className="space-y-3">
      {payload.context && (
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Match Preview</div>
          <p className="text-sm text-white/80 leading-relaxed">{payload.context}</p>
        </div>
      )}
      {payload.keyInsights && payload.keyInsights.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Key Insights</div>
          <ul className="space-y-1">
            {payload.keyInsights.map((ins, i) => (
              <li key={i} className="text-sm text-white/70 flex gap-2">
                <span className="text-white/30">·</span>{ins}
              </li>
            ))}
          </ul>
        </div>
      )}
      {payload.tacticalBattle && (
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Tactical Battle</div>
          <p className="text-sm text-white/80 leading-relaxed">{payload.tacticalBattle}</p>
        </div>
      )}
      {(payload.playerSpotlight || payload.verdict) && (
        <div className="grid grid-cols-2 gap-4">
          {payload.playerSpotlight && (
            <div>
              <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Spotlight</div>
              <p className="text-sm text-white/70">{payload.playerSpotlight}</p>
            </div>
          )}
          {payload.verdict && (
            <div>
              <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">Verdict</div>
              <p className="text-sm text-white/70 italic">{payload.verdict}</p>
            </div>
          )}
        </div>
      )}
      {payload.mediaWatch && payload.mediaWatch.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1">From the media</div>
          <ul className="space-y-1">
            {payload.mediaWatch.map((item, i) => (
              <li key={i} className="text-sm text-white/70 flex gap-2">
                <span className="text-white/30">·</span>{item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── ResultColumn ─────────────────────────────────────────────────────────────

function ResultColumn({
  label,
  model,
  models,
  onModelChange,
  onRun,
  running,
  result,
}: {
  label: string;
  model: string;
  models: string[];
  onModelChange: (m: string) => void;
  onRun: () => void;
  running: boolean;
  result: RunResult | null;
}) {
  const [showRaw, setShowRaw]     = useState(false);
  const [showThink, setShowThink] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">{label}</div>
      <div className="flex gap-2">
        <select
          value={model}
          onChange={e => onModelChange(e.target.value)}
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white/80 min-w-0"
        >
          {models.length === 0 && <option value="">No models found</option>}
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          onClick={onRun}
          disabled={running || !model}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-white/30 rounded text-sm font-medium text-white transition-colors"
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-white/40">
            <span>{(result.ms / 1000).toFixed(1)}s</span>
            {result.error && <span className="text-red-400">{result.error}</span>}
          </div>

          {result.thinkBlock && (
            <div className="border border-white/10 rounded overflow-hidden">
              <button
                onClick={() => setShowThink(t => !t)}
                className="w-full text-left px-3 py-1.5 text-xs text-white/40 hover:text-white/60 bg-white/5 hover:bg-white/10 transition-colors flex items-center gap-1"
              >
                <span>{showThink ? '▼' : '▶'}</span>
                <span>Think block ({result.thinkBlock.length} chars)</span>
              </button>
              {showThink && (
                <pre className="px-3 py-2 text-xs text-white/50 whitespace-pre-wrap overflow-auto max-h-48 bg-white/[0.02]">
                  {result.thinkBlock}
                </pre>
              )}
            </div>
          )}

          {result.parsed && (
            <div className="bg-white/[0.03] border border-white/10 rounded p-3">
              <PreviewView payload={result.parsed} />
            </div>
          )}

          {result.raw && (
            <div className="border border-white/10 rounded overflow-hidden">
              <button
                onClick={() => setShowRaw(r => !r)}
                className="w-full text-left px-3 py-1.5 text-xs text-white/40 hover:text-white/60 bg-white/5 hover:bg-white/10 transition-colors flex items-center gap-1"
              >
                <span>{showRaw ? '▼' : '▶'}</span>
                <span>Raw JSON</span>
              </button>
              {showRaw && (
                <pre className="px-3 py-2 text-xs text-white/50 whitespace-pre-wrap overflow-auto max-h-72 bg-white/[0.02]">
                  {typeof result.raw === 'string'
                    ? result.raw
                    : JSON.stringify(result.parsed, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main sandbox component ───────────────────────────────────────────────────

export default function SandboxClient() {
  const [gameId, setGameId]               = useState('wc-760421');
  const [loading, setLoading]             = useState(false);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [contextData, setContextData]     = useState<ContextData | null>(null);
  const [enabledBlocks, setEnabledBlocks] = useState<Set<string>>(new Set());
  const [prompt, setPrompt]               = useState('');
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [systemPrompt, setSystemPrompt]   = useState('');
  const [systemEdited, setSystemEdited]   = useState(false);
  const [models, setModels]               = useState<string[]>([]);
  const [leftModel, setLeftModel]         = useState('');
  const [rightModel, setRightModel]       = useState('');
  const [maxTokens, setMaxTokens]         = useState(8000);
  const [running, setRunning]             = useState(false);
  const [leftResult, setLeftResult]       = useState<RunResult | null>(null);
  const [rightResult, setRightResult]     = useState<RunResult | null>(null);

  // Fetch available models on mount
  useEffect(() => {
    fetch('/api/sandbox/models')
      .then(r => r.json())
      .then((d: { models: string[] }) => {
        setModels(d.models ?? []);
        if (d.models?.length > 0) {
          setLeftModel(d.models[0]);
          setRightModel(d.models[Math.min(1, d.models.length - 1)]);
        }
      })
      .catch(() => {});
  }, []);

  const composePrompt = useCallback(
    (blocks: BlockData[], enabledIds: Set<string>, footer: string): string => {
      const parts: string[] = [];
      for (const block of blocks) {
        if (enabledIds.has(block.id) && block.text) {
          parts.push(block.text);
        }
      }
      if (footer) parts.push(footer);
      return parts.join('\n');
    },
    [],
  );

  const handleLoad = useCallback(async () => {
    const id = gameId.trim();
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/sandbox/context?gameId=${encodeURIComponent(id)}`);
      const data = await res.json() as ContextData & { error?: string };
      if (!res.ok || data.error) {
        setLoadError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setContextData(data);
      // Enable all blocks by default
      const allEnabled = new Set(data.blocks.map(b => b.id));
      setEnabledBlocks(allEnabled);
      setPrompt(composePrompt(data.blocks, allEnabled, data.footer));
      setManuallyEdited(false);
      // Seed the system pane from the production system prompt the route imported.
      setSystemPrompt(data.systemPrompt);
      setSystemEdited(false);
      setLeftResult(null);
      setRightResult(null);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [gameId, composePrompt]);

  const handleBlockToggle = useCallback(
    (blockId: string) => {
      if (!contextData) return;
      // matchFacts is always-on
      if (blockId === 'matchFacts') return;
      setEnabledBlocks(prev => {
        const next = new Set(prev);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        const newPrompt = composePrompt(contextData.blocks, next, contextData.footer);
        setPrompt(newPrompt);
        setManuallyEdited(false);
        return next;
      });
    },
    [contextData, composePrompt],
  );

  const handleRun = useCallback(async () => {
    if (!prompt || (!leftModel && !rightModel)) return;
    setRunning(true);
    setLeftResult(null);
    setRightResult(null);

    const runOne = async (model: string): Promise<RunResult> => {
      const t0 = Date.now();
      try {
        const res = await fetch('/api/sandbox/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model, system: systemPrompt, maxTokens }),
        });
        const data = await res.json() as RunResult & { error?: string };
        if (!res.ok || data.error) {
          return { parsed: null, ms: Date.now() - t0, error: data.error };
        }
        return { ...data, ms: data.ms ?? Date.now() - t0 };
      } catch (err) {
        return { parsed: null, ms: Date.now() - t0, error: String(err) };
      }
    };

    try {
      const [lr, rr] = await Promise.all([
        leftModel  ? runOne(leftModel)  : Promise.resolve<RunResult>({ parsed: null, ms: 0 }),
        rightModel ? runOne(rightModel) : Promise.resolve<RunResult>({ parsed: null, ms: 0 }),
      ]);
      if (leftModel)  setLeftResult(lr);
      if (rightModel) setRightResult(rr);
    } finally {
      setRunning(false);
    }
  }, [prompt, systemPrompt, leftModel, rightModel, maxTokens]);

  const resetSystemPrompt = useCallback(() => {
    if (!contextData) return;
    setSystemPrompt(contextData.systemPrompt);
    setSystemEdited(false);
  }, [contextData]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header bar */}
      <div className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-white/60 shrink-0">Preview Sandbox</span>
        <span className="text-white/20 shrink-0">|</span>
        <input
          type="text"
          value={gameId}
          onChange={e => setGameId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLoad()}
          placeholder="Game ID e.g. wc-760421"
          className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white/80 w-48 font-mono"
        />
        <button
          onClick={handleLoad}
          disabled={loading}
          className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-white/10 disabled:text-white/30 rounded text-sm font-medium text-white transition-colors"
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
        {contextData && (
          <span className="text-sm text-white/50">{contextData.gameLabel}</span>
        )}
        {loadError && (
          <span className="text-sm text-red-400">{loadError}</span>
        )}
      </div>

      <div className="p-4 space-y-4 max-w-[1600px] mx-auto">
        {/* Block selector */}
        {contextData && (
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
              Prompt Blocks
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {contextData.blocks.map(block => {
                const isMatchFacts = block.id === 'matchFacts';
                const isEnabled    = enabledBlocks.has(block.id);
                const hasContent   = block.text.trim().length > 0;
                return (
                  <label
                    key={block.id}
                    className={`flex items-start gap-2 p-2 rounded cursor-pointer border transition-colors ${
                      isEnabled
                        ? 'border-blue-500/40 bg-blue-500/10'
                        : 'border-white/10 bg-white/[0.02]'
                    } ${isMatchFacts ? 'opacity-60 cursor-default' : 'hover:border-white/20'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={isMatchFacts}
                      onChange={() => handleBlockToggle(block.id)}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-white/70 leading-snug">{block.label}</div>
                      {!hasContent && (
                        <div className="text-[10px] text-white/30 mt-0.5">no data</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* System instructions textarea — the system message (production system prompt). */}
        {contextData && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">
                System instructions ({systemPrompt.length.toLocaleString()} chars)
                <span className="ml-2 normal-case tracking-normal text-white/30">— the rules layer (system message)</span>
              </div>
              <div className="flex items-center gap-3">
                {systemEdited && (
                  <span className="text-xs text-amber-400/70">Edited — differs from production default</span>
                )}
                <button
                  onClick={resetSystemPrompt}
                  disabled={!systemEdited}
                  className="text-xs text-white/50 hover:text-white/80 disabled:opacity-30 disabled:hover:text-white/50"
                >
                  Reset to production default
                </button>
              </div>
            </div>
            <textarea
              value={systemPrompt}
              onChange={e => {
                setSystemPrompt(e.target.value);
                setSystemEdited(true);
              }}
              rows={12}
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 font-mono resize-y focus:outline-none focus:border-white/20"
            />
          </div>
        )}

        {/* Fixture-context textarea — the user message (per-fixture data block). */}
        {contextData && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">
                Fixture context ({prompt.length.toLocaleString()} chars)
                <span className="ml-2 normal-case tracking-normal text-white/30">— the data layer (user message)</span>
              </div>
              {manuallyEdited && (
                <div className="text-xs text-amber-400/70">
                  Manually edited — next block toggle will overwrite
                </div>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setManuallyEdited(true);
              }}
              rows={20}
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 font-mono resize-y focus:outline-none focus:border-white/20"
            />
          </div>
        )}

        {/* Max-tokens control — applies to both columns. Default 8000 covers the
            thinking model's reasoning block + JSON answer. */}
        {contextData && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <label htmlFor="maxTokens">max_tokens</label>
            <input
              id="maxTokens"
              type="number"
              min={500}
              step={500}
              value={maxTokens}
              onChange={e => setMaxTokens(Math.max(1, parseInt(e.target.value, 10) || 8000))}
              className="w-24 bg-white/[0.03] border border-white/10 rounded px-2 py-1 text-white/70 font-mono focus:outline-none focus:border-white/20"
            />
            <span className="text-white/30">ceiling against cut-off — raise for the thinking model; not a length target</span>
          </div>
        )}

        {/* Two-column run area */}
        {contextData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResultColumn
              label="Left"
              model={leftModel}
              models={models}
              onModelChange={setLeftModel}
              onRun={handleRun}
              running={running}
              result={leftResult}
            />
            <ResultColumn
              label="Right"
              model={rightModel}
              models={models}
              onModelChange={setRightModel}
              onRun={handleRun}
              running={running}
              result={rightResult}
            />
          </div>
        )}

        {!contextData && !loading && (
          <div className="text-center py-16 text-white/30 text-sm">
            Enter a game ID above and click Load to begin.
          </div>
        )}
      </div>
    </div>
  );
}
