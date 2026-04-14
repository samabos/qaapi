import { useState } from 'react';
import type { TestSuite, Journey, RunResult, HttpMethod } from '../types';

interface SidebarProps {
  suites: TestSuite[];
  selectedSuiteId: string | null;
  selectedJourneyId: string | null;
  runResults: RunResult[];
  onSelect: (suiteId: string, journeyId: string) => void;
  onRunJourney: (suiteId: string, journeyId: string) => void;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green',
  POST: 'text-accent',
  PUT: 'text-yellow',
  PATCH: 'text-yellow',
  DELETE: 'text-red',
};

const TAG_COLORS: Record<string, string> = {
  'happy-path': 'bg-green/15 text-green',
  'validation': 'bg-yellow/15 text-yellow',
  'not-found': 'bg-red/15 text-red',
  'crud-flow': 'bg-accent/15 text-accent',
  'edge-case': 'bg-text-muted/15 text-text-muted',
};

const TAG_SHORT: Record<string, string> = {
  'happy-path': 'happy',
  'validation': 'valid',
  'not-found': '404',
  'crud-flow': 'crud',
  'edge-case': 'edge',
};

/** Derive the primary endpoint key from a journey's first step. */
function endpointKey(journey: Journey): string {
  const first = journey.steps[0];
  if (!first) return 'unknown';
  // Normalize path params: /api/items/{id} and /api/items/{{ctx.id}} → /api/items/{id}
  const normalized = first.path.replace(/\{\{[^}]+\}\}/g, '{id}');
  return `${first.method} ${normalized}`;
}

function groupByEndpoint(journeys: Journey[]): Map<string, Journey[]> {
  const groups = new Map<string, Journey[]>();
  for (const j of journeys) {
    const key = endpointKey(j);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(j);
  }
  return groups;
}

export default function Sidebar({
  suites,
  selectedSuiteId,
  selectedJourneyId,
  runResults,
  onSelect,
  onRunJourney,
}: SidebarProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(
    new Set(suites.map(s => s.id)),
  );
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());

  const toggleSuite = (id: string) => {
    setExpandedSuites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEndpoint = (key: string) => {
    setExpandedEndpoints(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getJourneyStatus = (suiteId: string, journeyId: string): 'none' | 'passed' | 'failed' | 'mixed' => {
    const results = runResults.filter(r => r.suiteId === suiteId && r.journeyId === journeyId);
    if (results.length === 0) return 'none';
    if (results.every(r => r.passed)) return 'passed';
    if (results.every(r => !r.passed)) return 'failed';
    return 'mixed';
  };

  const statusDot = (status: 'none' | 'passed' | 'failed' | 'mixed') => {
    const colors = {
      none: 'bg-text-muted/30',
      passed: 'bg-green',
      failed: 'bg-red',
      mixed: 'bg-yellow',
    };
    return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status]}`} />;
  };

  const tagBadge = (tag: string) => {
    const color = TAG_COLORS[tag] ?? 'bg-text-muted/15 text-text-muted';
    const label = TAG_SHORT[tag] ?? tag;
    return (
      <span className={`px-1 py-0.5 rounded text-[9px] leading-none font-medium flex-shrink-0 ${color}`}>
        {label}
      </span>
    );
  };

  const renderJourneyButton = (suiteId: string, journey: Journey) => {
    const status = getJourneyStatus(suiteId, journey.id);
    const isSelected = suiteId === selectedSuiteId && journey.id === selectedJourneyId;
    const firstTag = journey.tags?.[0];

    return (
      <button
        key={journey.id}
        onClick={() => onSelect(suiteId, journey.id)}
        className={`group w-full flex items-center gap-1.5 px-2 py-1 text-xs transition-colors ${
          isSelected
            ? 'bg-accent/10 text-accent'
            : 'text-text-muted hover:text-text hover:bg-surface2'
        }`}
      >
        {statusDot(status)}
        <span className="truncate flex-1 text-left">{journey.name}</span>
        {firstTag && tagBadge(firstTag)}
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRunJourney(suiteId, journey.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-accent hover:text-text transition-opacity cursor-pointer flex-shrink-0"
          title="Run journey"
        >
          {'\u25B6'}
        </span>
      </button>
    );
  };

  return (
    <div className="w-64 border-r border-border bg-surface overflow-y-auto flex-shrink-0">
      <div className="px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
        Test Suites
      </div>
      {suites.length === 0 && (
        <div className="px-3 py-4 text-xs text-text-muted">
          No test suites yet. Click Generate to create tests from your API spec.
        </div>
      )}
      {suites.map(suite => (
        <div key={suite.id}>
          <button
            onClick={() => toggleSuite(suite.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-surface2 transition-colors"
          >
            <span className="text-text-muted text-xs">
              {expandedSuites.has(suite.id) ? '\u25BC' : '\u25B6'}
            </span>
            <span className="font-medium">{suite.name}</span>
            <span className="ml-auto text-xs text-text-muted">
              {suite.journeys.length}
            </span>
          </button>

          {expandedSuites.has(suite.id) && (
            <div className="ml-2">
              {Array.from(groupByEndpoint(suite.journeys).entries()).map(([ep, journeys]) => {
                const epKey = `${suite.id}:${ep}`;
                const isExpanded = expandedEndpoints.has(epKey);
                // Parse "POST /api/cap/applications" → method + path
                const spaceIdx = ep.indexOf(' ');
                const method = ep.substring(0, spaceIdx) as HttpMethod;
                const path = ep.substring(spaceIdx + 1);
                const methodColor = METHOD_COLORS[method] ?? 'text-text-muted';

                return (
                  <div key={ep}>
                    <button
                      onClick={() => toggleEndpoint(epKey)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-surface2 transition-colors"
                    >
                      <span className="text-[10px]">
                        {isExpanded ? '\u25BC' : '\u25B6'}
                      </span>
                      <span className={`font-mono font-bold text-[10px] ${methodColor}`}>
                        {method}
                      </span>
                      <span className="font-mono text-[10px] truncate flex-1 text-left">
                        {path}
                      </span>
                      <span className="text-[10px] text-text-muted flex-shrink-0">
                        {journeys.length}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="ml-3">
                        {journeys.map(journey => renderJourneyButton(suite.id, journey))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
