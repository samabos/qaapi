import { useMemo, useState } from 'react';

/**
 * Lightweight recursive JSON viewer.
 *  - Collapsible objects and arrays (caret toggle)
 *  - Expand-all / Collapse-all
 *  - Raw / tree view toggle
 *  - Filter that auto-expands ancestors of matches
 *  - Color-coded primitives
 *
 * No external deps. Styled against VSCode theme tokens.
 */

interface Props {
  data: unknown;
  /** Nodes above this depth start expanded on first render. */
  defaultExpandDepth?: number;
}

type ViewMode = 'tree' | 'raw';

export default function JsonTree({ data, defaultExpandDepth = 1 }: Readonly<Props>) {
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [allOverride, setAllOverride] = useState<boolean | null>(null);
  const [treeVersion, setTreeVersion] = useState(0); // bump to reset per-node local state

  const matchPaths = useMemo(() => {
    if (!query.trim()) return null;
    const needle = query.toLowerCase();
    const paths = new Set<string>();
    walk(data, '', (path, value) => {
      const key = path.split('.').pop() ?? '';
      const valueStr = stringifyPrimitive(value).toLowerCase();
      if (key.toLowerCase().includes(needle) || valueStr.includes(needle)) {
        let p = path;
        while (p) {
          paths.add(p);
          const idx = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
          p = idx > 0 ? p.slice(0, idx) : '';
        }
        paths.add('');
      }
    });
    return paths;
  }, [data, query]);

  const collapseAll = () => {
    setAllOverride(false);
    setTreeVersion(v => v + 1);
  };
  const expandAll = () => {
    setAllOverride(true);
    setTreeVersion(v => v + 1);
  };

  if (data === null || data === undefined) {
    return <div className="text-xs text-text-muted italic p-2">No data</div>;
  }

  return (
    <div className="bg-surface2 rounded border border-border">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
        {viewMode === 'tree' && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter..."
            className="flex-1 bg-transparent text-text text-[11px] px-1 py-0.5 outline-none"
          />
        )}
        {viewMode === 'raw' && <div className="flex-1" />}
        {viewMode === 'tree' && (
          <>
            <button
              onClick={expandAll}
              title="Expand all"
              className="text-[10px] text-text-muted hover:text-text transition-colors px-1"
            >
              expand all
            </button>
            <button
              onClick={collapseAll}
              title="Collapse all"
              className="text-[10px] text-text-muted hover:text-text transition-colors px-1"
            >
              collapse all
            </button>
          </>
        )}
        <button
          onClick={() => setViewMode(viewMode === 'tree' ? 'raw' : 'tree')}
          title={viewMode === 'tree' ? 'Switch to raw JSON' : 'Switch to tree view'}
          className="text-[10px] text-text-muted hover:text-text transition-colors px-1"
        >
          {viewMode === 'tree' ? 'raw' : 'tree'}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
          title="Copy as JSON"
          className="text-[10px] text-text-muted hover:text-text transition-colors px-1"
        >
          copy
        </button>
      </div>
      <div className="p-2 text-xs font-mono overflow-x-auto max-h-96">
        {viewMode === 'raw' ? (
          <pre className="text-text whitespace-pre-wrap break-words">
            {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          <Node
            key={treeVersion}
            value={data}
            path=""
            depth={0}
            defaultExpandDepth={defaultExpandDepth}
            allOverride={allOverride}
            matchPaths={matchPaths}
          />
        )}
      </div>
    </div>
  );
}

/* ---- recursive node ------------------------------------------------- */

interface NodeProps {
  value: unknown;
  path: string;
  depth: number;
  defaultExpandDepth: number;
  allOverride: boolean | null;
  matchPaths: Set<string> | null;
}

function Node({ value, path, depth, defaultExpandDepth, allOverride, matchPaths }: Readonly<NodeProps>) {
  const forceOpen = matchPaths?.has(path) ?? false;
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);

  const computedDefault = allOverride ?? (forceOpen || depth < defaultExpandDepth);
  const isOpen = manuallyOpen ?? computedDefault;

  if (value === null) return <span className="text-text-muted">null</span>;
  if (typeof value === 'undefined') return <span className="text-text-muted">undefined</span>;

  if (typeof value === 'string') {
    return <span className="text-green">"{value}"</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-accent">{String(value)}</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="text-yellow">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-muted">[]</span>;
    const preview = `[ ${value.length} ${value.length === 1 ? 'item' : 'items'} ]`;
    return (
      <span>
        <button
          onClick={() => setManuallyOpen(!isOpen)}
          className="text-text-muted hover:text-text mr-0.5 cursor-pointer"
        >
          {isOpen ? '▾' : '▸'}
        </button>
        {!isOpen ? (
          <span className="text-text-muted">{preview}</span>
        ) : (
          <div className="ml-3 border-l border-border pl-2">
            {value.map((item, i) => (
              <div key={i}>
                <span className="text-text-muted">{i}</span>
                <span className="text-text-muted">: </span>
                <Node
                  value={item}
                  path={`${path}[${i}]`}
                  depth={depth + 1}
                  defaultExpandDepth={defaultExpandDepth}
                  allOverride={allOverride}
                  matchPaths={matchPaths}
                />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-text-muted">{'{}'}</span>;
    const preview = `{ ${entries.length} ${entries.length === 1 ? 'field' : 'fields'} }`;
    return (
      <span>
        <button
          onClick={() => setManuallyOpen(!isOpen)}
          className="text-text-muted hover:text-text mr-0.5 cursor-pointer"
        >
          {isOpen ? '▾' : '▸'}
        </button>
        {!isOpen ? (
          <span className="text-text-muted">{preview}</span>
        ) : (
          <div className="ml-3 border-l border-border pl-2">
            {entries.map(([k, v]) => (
              <div key={k}>
                <span className="text-text">{k}</span>
                <span className="text-text-muted">: </span>
                <Node
                  value={v}
                  path={path ? `${path}.${k}` : k}
                  depth={depth + 1}
                  defaultExpandDepth={defaultExpandDepth}
                  allOverride={allOverride}
                  matchPaths={matchPaths}
                />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span className="text-text-muted">{String(value)}</span>;
}

/* ---- helpers -------------------------------------------------------- */

function walk(value: unknown, path: string, fn: (p: string, v: unknown) => void): void {
  fn(path, value);
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, fn));
    } else {
      for (const [k, v] of Object.entries(value)) {
        walk(v, path ? `${path}.${k}` : k, fn);
      }
    }
  }
}

function stringifyPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v);
}
