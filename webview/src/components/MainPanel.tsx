import { useState, useEffect } from 'react';
import type { Journey, Step, StepResult, RunResult, HttpMethod } from '../types';
import JsonTree from './JsonTree';

interface MainPanelProps {
  journey: Journey | null;
  suiteId: string | null;
  stepResults: StepResult[];
  runResults: RunResult[];
  onRunJourney: (suiteId: string, journeyId: string) => void;
  onRunStep: (suiteId: string, journeyId: string, stepId: string) => void;
  onUpdateJourney: (suiteId: string, journey: Journey) => void;
  onSuggestPayload: (suiteId: string, journeyId: string, stepId: string, description: string) => void;
  suggestingStepId: string | null;
}

const METHODS_WITH_BODY: HttpMethod[] = ['POST', 'PUT', 'PATCH'];

/* ---- Shared tab control --------------------------------------------- */

function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: readonly T[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex border-b border-border">
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-3 py-1 text-[11px] font-medium transition-colors ${
            active === t
              ? 'text-text border-b-2 border-accent -mb-px'
              : 'text-text-muted hover:text-text'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ---- Editable JSON body --------------------------------------------- */

function BodyEditor({ value, onSave, readOnly }: {
  value: Record<string, unknown> | undefined;
  onSave: (next: Record<string, unknown> | undefined) => void;
  readOnly?: boolean;
}) {
  const format = (v: Record<string, unknown> | undefined) =>
    v && Object.keys(v).length > 0 ? JSON.stringify(v, null, 2) : '';

  const [text, setText] = useState(format(value));
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the journey is swapped from under us
  useEffect(() => {
    setText(format(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError(null);
      onSave(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      setError(null);
      onSave(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  if (readOnly) {
    return (
      <pre className="p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-64 text-text">
        {text || <span className="text-text-muted italic">No body</span>}
      </pre>
    );
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        placeholder={'{\n  "field": "value"\n}'}
        rows={Math.max(6, Math.min(18, text.split('\n').length + 1))}
        className={`w-full p-2 bg-surface2 rounded text-xs font-mono text-text border outline-none transition-colors ${
          error ? 'border-red' : 'border-border focus:border-accent'
        }`}
      />
      {error && (
        <div className="mt-1 text-[11px] text-red">Invalid JSON: {error}</div>
      )}
      {!error && (
        <div className="mt-1 text-[10px] text-text-muted">
          Auto-saves when the field loses focus.
        </div>
      )}
    </div>
  );
}

/* ---- Key / value editor (headers, query params) -------------------- */

function KeyValueEditor({ value, onSave, readOnly }: {
  value: Record<string, string> | undefined;
  onSave: (next: Record<string, string> | undefined) => void;
  readOnly?: boolean;
}) {
  const entries = Object.entries(value ?? {});

  if (readOnly) {
    if (entries.length === 0) {
      return <div className="text-xs text-text-muted italic p-2">No entries</div>;
    }
    return (
      <pre className="p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-48 text-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const display = entries.length === 0 ? [['', '']] : entries;

  const update = (idx: number, key: string, val: string) => {
    const next: Record<string, string> = {};
    display.forEach(([k, v], i) => {
      const fk = i === idx ? key : k;
      const fv = i === idx ? val : v;
      if (fk) next[fk] = fv;
    });
    onSave(Object.keys(next).length > 0 ? next : undefined);
  };

  const remove = (idx: number) => {
    const next: Record<string, string> = {};
    display.forEach(([k, v], i) => {
      if (i !== idx && k) next[k] = v;
    });
    onSave(Object.keys(next).length > 0 ? next : undefined);
  };

  const add = () => {
    onSave({ ...(value ?? {}), '': '' });
  };

  return (
    <div className="space-y-1">
      {display.map(([k, v], idx) => (
        <div key={idx} className="flex gap-1">
          <input
            type="text"
            value={k}
            onChange={(e) => update(idx, e.target.value, v)}
            placeholder="key"
            className="flex-1 bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none font-mono"
          />
          <input
            type="text"
            value={v}
            onChange={(e) => update(idx, k, e.target.value)}
            placeholder="value"
            className="flex-[2] bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none font-mono"
          />
          <button
            onClick={() => remove(idx)}
            className="px-1.5 text-xs text-text-muted hover:text-red transition-colors"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-[11px] text-accent hover:text-accent/80 transition-colors"
      >
        + Add
      </button>
    </div>
  );
}


const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green',
  POST: 'text-accent',
  PUT: 'text-yellow',
  PATCH: 'text-yellow',
  DELETE: 'text-red',
};

function CollapsibleSection({ title, defaultOpen = false, children }: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] uppercase text-text-muted font-medium hover:text-text transition-colors"
      >
        <span className="text-[8px]">{open ? '\u25BC' : '\u25B6'}</span>
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function MainPanel({ journey, suiteId, stepResults, runResults, onRunJourney, onRunStep, onUpdateJourney, onSuggestPayload, suggestingStepId }: MainPanelProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [reqTab, setReqTab] = useState<'Body' | 'Headers' | 'Query' | 'Path' | 'Sent'>('Body');
  const [resTab, setResTab] = useState<'Body' | 'Headers'>('Body');
  const [caseDescriptions, setCaseDescriptions] = useState<Record<string, string>>({});

  const updateStep = (stepId: string, patch: Partial<Step>) => {
    if (!journey || !suiteId) return;
    const next: Journey = {
      ...journey,
      steps: journey.steps.map(s => s.id === stepId ? { ...s, ...patch } : s),
    };
    onUpdateJourney(suiteId, next);
  };

  if (!journey) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Select a journey from the sidebar to view details
      </div>
    );
  }

  const getStepResult = (stepId: string): StepResult | undefined =>
    stepResults.find(r => r.stepId === stepId);

  const statusBadge = (status: StepResult['status']) => {
    const styles: Record<string, string> = {
      pending: 'bg-text-muted/20 text-text-muted',
      running: 'bg-accent/20 text-accent',
      passed: 'bg-green/20 text-green',
      failed: 'bg-red/20 text-red',
      skipped: 'bg-text-muted/10 text-text-muted',
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const renderRequestSection = (step: Step, result: StepResult | undefined) => {
    const supportsBody = METHODS_WITH_BODY.includes(step.method);
    const pathParamNames = [...new Set(
      [...step.path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]),
    )];
    const hasPathParams = pathParamNames.length > 0;
    const hasSent = !!(result?.requestHeaders || result?.requestBody !== undefined);
    const baseTabs: ('Body' | 'Headers' | 'Query' | 'Path')[] = supportsBody
      ? ['Body', 'Headers', 'Query']
      : ['Headers', 'Query'];
    if (hasPathParams) baseTabs.unshift('Path');
    const tabs: ('Body' | 'Headers' | 'Query' | 'Path' | 'Sent')[] = hasSent
      ? [...baseTabs, 'Sent']
      : baseTabs;
    const active = tabs.includes(reqTab) ? reqTab : tabs[0];

    return (
      <CollapsibleSection title="Request" defaultOpen>
        {result?.requestUrl && (
          <div className="mb-2">
            <span className="text-[10px] text-text-muted">URL: </span>
            <span className="font-mono text-xs text-text break-all">{result.requestUrl}</span>
          </div>
        )}

        <Tabs tabs={tabs} active={active} onChange={setReqTab} />

        <div className="pt-2">
          {active === 'Body' && supportsBody && (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={caseDescriptions[step.id] ?? ''}
                  onChange={(e) => setCaseDescriptions(prev => ({ ...prev, [step.id]: e.target.value }))}
                  placeholder='What are you testing? e.g. "missing required field", "valid happy path"'
                  className="flex-1 bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none"
                />
                <button
                  onClick={() => suiteId && onSuggestPayload(suiteId, journey.id, step.id, caseDescriptions[step.id] ?? '')}
                  disabled={!suiteId || suggestingStepId === step.id}
                  title="Ask Claude to suggest a payload for this case (requires the `claude` CLI on PATH)"
                  className="px-2 py-1 text-xs rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {suggestingStepId === step.id ? 'Thinking...' : '\u2728 Suggest'}
                </button>
              </div>
              <BodyEditor
                value={step.payload}
                onSave={(next) => updateStep(step.id, { payload: next })}
              />
            </div>
          )}
          {active === 'Headers' && (
            <KeyValueEditor
              value={step.headers}
              onSave={(next) => updateStep(step.id, { headers: next })}
            />
          )}
          {active === 'Query' && (
            <KeyValueEditor
              value={step.queryParams}
              onSave={(next) => updateStep(step.id, { queryParams: next })}
            />
          )}
          {active === 'Path' && hasPathParams && (
            <div className="space-y-1">
              {pathParamNames.map((name) => (
                <div key={name} className="flex gap-1 items-center">
                  <span className="font-mono text-xs text-text-muted w-32 truncate">{`{${name}}`}</span>
                  <input
                    type="text"
                    defaultValue={step.pathParams?.[name] ?? ''}
                    onBlur={(e) => {
                      const next = { ...(step.pathParams ?? {}) };
                      const v = e.target.value.trim();
                      if (v) next[name] = v;
                      else delete next[name];
                      updateStep(step.id, { pathParams: Object.keys(next).length ? next : undefined });
                    }}
                    placeholder="value"
                    className="flex-1 bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none font-mono"
                  />
                </div>
              ))}
            </div>
          )}
          {active === 'Sent' && result && (
            <div className="space-y-3">
              {result.requestBody !== undefined && (
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">Body</div>
                  <JsonTree data={result.requestBody} />
                </div>
              )}
              {result.requestHeaders && Object.keys(result.requestHeaders).length > 0 && (
                <div>
                  <div className="text-[10px] text-text-muted mb-0.5">Headers (includes auto-injected Authorization)</div>
                  <JsonTree data={result.requestHeaders} />
                </div>
              )}
            </div>
          )}
        </div>

      </CollapsibleSection>
    );
  };

  const renderResponseSection = (result: StepResult) => {
    const tabs = ['Body', 'Headers'] as const;
    return (
      <CollapsibleSection title="Response" defaultOpen>
        <Tabs tabs={tabs} active={resTab} onChange={setResTab} />
        <div className="pt-2">
          {resTab === 'Body' && <JsonTree data={result.responseBody} defaultExpandDepth={2} />}
          {resTab === 'Headers' && <JsonTree data={result.responseHeaders} />}
        </div>
      </CollapsibleSection>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Journey header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium text-text">{journey.name}</h2>
          {suiteId && (
            <button
              onClick={() => onRunJourney(suiteId, journey.id)}
              className="px-2 py-0.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
              title="Run this journey"
            >
              {'\u25B6'} Run
            </button>
          )}
        </div>
        <p className="text-sm text-text-muted mt-1">{journey.description}</p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {journey.steps.map((step, i) => {
          const result = getStepResult(step.id);
          const isExpanded = expandedStep === step.id;

          return (
            <div key={step.id} className="bg-surface rounded border border-border">
              <button
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                className="group w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface2 transition-colors"
              >
                <span className="text-text-muted text-xs w-5 text-right">{i + 1}</span>
                <span className={`font-mono text-xs font-bold w-14 ${METHOD_COLORS[step.method]}`}>
                  {step.method}
                </span>
                <span className="font-mono text-xs text-text flex-1 truncate">{step.path}</span>
                {suiteId && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunStep(suiteId, journey.id, step.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-accent hover:text-text transition-opacity cursor-pointer text-xs flex-shrink-0"
                    title="Run this step"
                  >
                    {'\u25B6'}
                  </span>
                )}
                {result && statusBadge(result.status)}
                {result?.durationMs !== undefined && (
                  <span className="text-[10px] text-text-muted">{result.durationMs}ms</span>
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border">
                  <div className="mt-2 text-xs text-text-muted">{step.name}</div>

                  {/* Skip reason */}
                  {result?.status === 'skipped' && (() => {
                    const failedStep = stepResults.find(r => r.status === 'failed');
                    return (
                      <div className="mt-2 p-2 bg-text-muted/10 border border-text-muted/20 rounded text-xs text-text-muted">
                        Skipped{failedStep ? `: step "${failedStep.stepName}" failed` : ': a previous step failed'}
                      </div>
                    );
                  })()}

                  {/* Status code: expected vs actual */}
                  <div className="mt-2">
                    <span className="text-[10px] uppercase text-text-muted font-medium">Status Code</span>
                    <div className="mt-1 flex items-center gap-3 font-mono text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-text-muted">expected:</span>
                        <input
                          type="number"
                          min={100}
                          max={599}
                          defaultValue={step.expectedStatus}
                          onBlur={(e) => {
                            const next = parseInt(e.target.value, 10);
                            if (!Number.isNaN(next) && next !== step.expectedStatus) {
                              updateStep(step.id, { expectedStatus: next });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                          }}
                          className="w-14 bg-surface2 text-text px-1 py-0 rounded border border-border focus:border-accent outline-none"
                          title="Edit expected status code"
                        />
                      </div>
                      {result?.statusCode !== undefined && (
                        <>
                          <div>
                            <span className="text-text-muted">actual: </span>
                            <span className={result.statusCode === step.expectedStatus ? 'text-green' : 'text-red'}>
                              {result.statusCode}
                            </span>
                          </div>
                          <span className={`text-[10px] ${result.statusCode === step.expectedStatus ? 'text-green' : 'text-red'}`}>
                            {result.statusCode === step.expectedStatus ? '\u2713' : '\u2717 mismatch'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Assertions */}
                  {step.assertions.length > 0 && (
                    <div className="mt-2">
                      <span className="text-[10px] uppercase text-text-muted font-medium">Assertions</span>
                      <div className="mt-1 space-y-1">
                        {step.assertions.map((a, ai) => {
                          const aResult = result?.assertions[ai];
                          return (
                            <div key={ai} className="text-xs font-mono">
                              <div className="flex items-center gap-2">
                                {aResult && (
                                  <span className={aResult.passed ? 'text-green' : 'text-red'}>
                                    {aResult.passed ? '\u2713' : '\u2717'}
                                  </span>
                                )}
                                <span className="text-text-muted">{a.path}</span>
                                {a.equals !== undefined && (
                                  <span className="text-text">== {JSON.stringify(a.equals)}</span>
                                )}
                                {a.exists !== undefined && (
                                  <span className="text-text">{a.exists ? 'exists' : '!exists'}</span>
                                )}
                                {a.contains !== undefined && (
                                  <span className="text-text">contains {JSON.stringify(a.contains)}</span>
                                )}
                                {a.greaterThan !== undefined && (
                                  <span className="text-text">&gt; {a.greaterThan}</span>
                                )}
                              </div>
                              {aResult && !aResult.passed && (
                                <div className="ml-5 mt-0.5 space-y-0.5">
                                  <div className="text-green">
                                    <span className="text-text-muted">expected: </span>
                                    {JSON.stringify(aResult.expected)}
                                  </div>
                                  <div className="text-red">
                                    <span className="text-text-muted">actual:&nbsp;&nbsp; </span>
                                    {JSON.stringify(aResult.actual)}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Request section */}
                  {renderRequestSection(step, result)}

                  {/* Response section */}
                  {result && (
                    result.responseBody !== undefined ||
                    (result.responseHeaders && Object.keys(result.responseHeaders).length > 0)
                  ) && renderResponseSection(result)}

                  {/* Extracted values */}
                  {result?.extractedValues && Object.keys(result.extractedValues).length > 0 && (
                    <div className="mt-2">
                      <span className="text-[10px] uppercase text-text-muted font-medium">Extracted</span>
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(result.extractedValues).map(([k, v]) => (
                          <div key={k} className="text-xs font-mono">
                            <span className="text-accent">{k}</span>
                            <span className="text-text-muted"> = </span>
                            <span className="text-text">{JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {result?.error && (
                    <div className="mt-2 p-2 bg-red/10 border border-red/30 rounded text-xs text-red">
                      {result.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Extraction chain mappings */}
      {journey.extractions.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase text-text-muted font-medium mb-2">Chain Mappings</h3>
          <div className="space-y-1">
            {journey.extractions.map((ext, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className="text-text-muted">{ext.from}</span>
                <span className="text-accent">{'\u2192'}</span>
                <span className="text-text">{ext.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run results summary */}
      {runResults.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase text-text-muted font-medium mb-2">Run Results</h3>
          <div className="space-y-1">
            {runResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                  r.passed ? 'bg-green/10 text-green' : 'bg-red/10 text-red'
                }`}
              >
                <span>{r.passed ? '\u2713' : '\u2717'}</span>
                <span className="font-medium">{r.journeyName ?? r.journeyId}</span>
                <span className="text-text-muted">{'\u2014'} {r.passed ? 'Passed' : 'Failed'}</span>
                <span className="text-text-muted ml-auto">{r.durationMs}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
