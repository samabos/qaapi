import { useState } from 'react';
import type { Journey, Step, StepResult, RunResult, HttpMethod } from '../types';

interface MainPanelProps {
  journey: Journey | null;
  suiteId: string | null;
  stepResults: StepResult[];
  runResults: RunResult[];
  onRunJourney: (suiteId: string, journeyId: string) => void;
  onRunStep: (suiteId: string, journeyId: string, stepId: string) => void;
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

export default function MainPanel({ journey, suiteId, stepResults, runResults, onRunJourney, onRunStep }: MainPanelProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

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
    const hasRequestData = result?.requestUrl || result?.requestHeaders || result?.requestBody;
    const hasDefinition = step.payload || step.headers || step.queryParams;
    if (!hasRequestData && !hasDefinition) return null;

    return (
      <CollapsibleSection title="Request">
        {result?.requestUrl && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">URL: </span>
            <span className="font-mono text-xs text-text break-all">{result.requestUrl}</span>
          </div>
        )}
        {result?.requestHeaders && Object.keys(result.requestHeaders).length > 0 && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">Headers:</span>
            <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-32 text-text">
              {JSON.stringify(result.requestHeaders, null, 2)}
            </pre>
          </div>
        )}
        {result?.requestBody !== undefined && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">Body:</span>
            <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-48 text-text">
              {JSON.stringify(result.requestBody, null, 2)}
            </pre>
          </div>
        )}
        {!result?.requestBody && step.payload && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">Payload (definition):</span>
            <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-48 text-text">
              {JSON.stringify(step.payload, null, 2)}
            </pre>
          </div>
        )}
        {!result?.requestHeaders && step.headers && Object.keys(step.headers).length > 0 && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">Headers (definition):</span>
            <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-32 text-text">
              {JSON.stringify(step.headers, null, 2)}
            </pre>
          </div>
        )}
        {step.queryParams && Object.keys(step.queryParams).length > 0 && (
          <div className="mb-1">
            <span className="text-[10px] text-text-muted">Query Params:</span>
            <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-32 text-text">
              {JSON.stringify(step.queryParams, null, 2)}
            </pre>
          </div>
        )}
      </CollapsibleSection>
    );
  };

  const renderResponseSection = (result: StepResult) => (
    <CollapsibleSection title="Response" defaultOpen>
      {result.responseHeaders && Object.keys(result.responseHeaders).length > 0 && (
        <div className="mb-1">
          <span className="text-[10px] text-text-muted">Headers:</span>
          <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-32 text-text">
            {JSON.stringify(result.responseHeaders, null, 2)}
          </pre>
        </div>
      )}
      {result.responseBody !== undefined && (
        <div>
          <span className="text-[10px] text-text-muted">Body:</span>
          <pre className="mt-0.5 p-2 bg-surface2 rounded text-xs font-mono overflow-x-auto max-h-48 text-text">
            {JSON.stringify(result.responseBody, null, 2)}
          </pre>
        </div>
      )}
    </CollapsibleSection>
  );

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
                      <div>
                        <span className="text-text-muted">expected: </span>
                        <span className="text-text">{step.expectedStatus}</span>
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
                  {result && (result.responseBody !== undefined || (result.responseHeaders && Object.keys(result.responseHeaders).length > 0)) && (
                    renderResponseSection(result)
                  )}

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
