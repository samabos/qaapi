import { useState } from 'react';
import type { TestSuite, Journey, RunResult, HttpMethod } from '../types';

interface SidebarProps {
  suites: TestSuite[];
  selectedSuiteId: string | null;
  selectedJourneyId: string | null;
  runResults: RunResult[];
  onSelect: (suiteId: string, journeyId: string) => void;
  onRunJourney: (suiteId: string, journeyId: string) => void;
  onRenameJourney: (suiteId: string, journeyId: string, newName: string) => void;
  onDuplicateJourney: (suiteId: string, journeyId: string) => void;
  onDeleteJourney: (suiteId: string, journeyId: string) => void;
  onDeleteSuite: (suiteId: string) => void;
  onExpandCases: (suiteId: string, journeyId: string) => void;
  expandingEndpointKey: string | null;
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
  onRenameJourney,
  onDuplicateJourney,
  onDeleteJourney,
  onDeleteSuite,
  onExpandCases,
  expandingEndpointKey,
}: SidebarProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(
    new Set(suites.map(s => s.id)),
  );
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const aggregateCounts = (suiteId: string, journeys: Journey[]) => {
    let passed = 0;
    let failed = 0;
    for (const j of journeys) {
      const s = getJourneyStatus(suiteId, j.id);
      if (s === 'passed') passed++;
      else if (s === 'failed' || s === 'mixed') failed++;
    }
    return { passed, failed, notRun: journeys.length - passed - failed };
  };

  const renderCounts = (c: { passed: number; failed: number; notRun: number }) => (
    <span className="flex items-center gap-1.5 text-[10px] font-mono flex-shrink-0">
      {c.passed > 0 && <span className="text-green">{c.passed}{'\u2713'}</span>}
      {c.failed > 0 && <span className="text-red">{c.failed}{'\u2717'}</span>}
      {c.notRun > 0 && <span className="text-text-muted">{c.notRun}</span>}
    </span>
  );

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

  const commitRename = (suiteId: string, journeyId: string) => {
    if (renameValue.trim()) onRenameJourney(suiteId, journeyId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  };

  const startRename = (journey: Journey) => {
    setRenamingId(journey.id);
    setRenameValue(journey.name);
    setConfirmDeleteId(null);
  };

  const renderJourneyButton = (suiteId: string, journey: Journey) => {
    const status = getJourneyStatus(suiteId, journey.id);
    const isSelected = suiteId === selectedSuiteId && journey.id === selectedJourneyId;
    const firstTag = journey.tags?.[0];
    const isRenaming = renamingId === journey.id;
    const isConfirmingDelete = confirmDeleteId === journey.id;

    return (
      <div
        key={journey.id}
        className={`group flex items-center gap-1.5 px-2 py-1 text-xs transition-colors ${
          isSelected ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text hover:bg-surface2'
        }`}
      >
        {statusDot(status)}

        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(suiteId, journey.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(suiteId, journey.id);
              if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
            }}
            className="flex-1 bg-surface2 text-text text-xs px-1 py-0 rounded border border-accent focus:border-accent outline-none font-mono"
          />
        ) : (
          <button
            onClick={() => onSelect(suiteId, journey.id)}
            className="truncate flex-1 text-left bg-transparent border-none p-0 cursor-pointer inherit-color"
          >
            {journey.name}
          </button>
        )}

        {!isRenaming && firstTag && tagBadge(firstTag)}

        {!isRenaming && !isConfirmingDelete && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onRunJourney(suiteId, journey.id); }}
              className="text-accent hover:text-text"
              title="Run journey"
            >{'\u25B6'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); startRename(journey); }}
              className="text-text-muted hover:text-text"
              title="Rename"
            >{'\u270E'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicateJourney(suiteId, journey.id); }}
              className="text-text-muted hover:text-text"
              title="Duplicate"
            >{'\u29C9'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(journey.id); }}
              className="text-text-muted hover:text-red"
              title="Delete"
            >{'\u00D7'}</button>
          </div>
        )}

        {isConfirmingDelete && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-red">Delete?</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteJourney(suiteId, journey.id);
                setConfirmDeleteId(null);
              }}
              className="text-red hover:text-text text-[10px]"
              title="Confirm delete"
            >{'\u2713'}</button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
              className="text-text-muted hover:text-text text-[10px]"
              title="Cancel"
            >{'\u00D7'}</button>
          </div>
        )}
      </div>
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
      {suites.map(suite => {
        const isConfirmingSuiteDelete = confirmDeleteId === suite.id;
        return (
        <div key={suite.id}>
          <div
            className="group w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-surface2 transition-colors"
          >
            <button
              onClick={() => toggleSuite(suite.id)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer inherit-color"
            >
              <span className="text-text-muted text-xs">
                {expandedSuites.has(suite.id) ? '\u25BC' : '\u25B6'}
              </span>
              <span className="font-medium truncate">{suite.name}</span>
            </button>
            {renderCounts(aggregateCounts(suite.id, suite.journeys))}
            {!isConfirmingSuiteDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(suite.id); }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red transition-opacity text-xs"
                title="Delete suite"
              >{'\u00D7'}</button>
            )}
            {isConfirmingSuiteDelete && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-red">Delete suite?</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSuite(suite.id);
                    setConfirmDeleteId(null);
                  }}
                  className="text-red hover:text-text text-[10px]"
                  title="Confirm"
                >{'\u2713'}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                  className="text-text-muted hover:text-text text-[10px]"
                  title="Cancel"
                >{'\u00D7'}</button>
              </div>
            )}
          </div>

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

                const isExpandingThis = expandingEndpointKey === epKey;
                return (
                  <div key={ep}>
                    <div className="group w-full flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-surface2 transition-colors">
                      <button
                        onClick={() => toggleEndpoint(epKey)}
                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer inherit-color"
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
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Use any journey in this group as the seed — the backend
                          // uses method+path + existing cases for dedup.
                          onExpandCases(suite.id, journeys[0].id);
                        }}
                        disabled={isExpandingThis}
                        className="opacity-0 group-hover:opacity-100 text-accent hover:text-text disabled:text-text-muted disabled:cursor-wait transition-opacity flex-shrink-0"
                        title="Ask Claude to generate extra test cases for this endpoint"
                      >
                        {isExpandingThis ? '…' : '\u2728'}
                      </button>
                      {renderCounts(aggregateCounts(suite.id, journeys))}
                    </div>
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
        );
      })}
    </div>
  );
}
