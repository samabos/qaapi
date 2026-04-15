import type { TokenChain, TokenStep } from '../types';

interface Props {
  chain: TokenChain;
  onChange: (chain: TokenChain) => void;
}

const emptyStep = (index: number): TokenStep => ({
  name: `step${index + 1}`,
  method: 'POST',
  url: '',
  bodyType: 'json',
  body: {},
  headers: {},
  extract: '$.access_token',
});

const inputClass =
  'w-full bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none font-mono';

export default function TokenChainEditor({ chain, onChange }: Readonly<Props>) {
  const steps = chain.steps;

  const updateStep = (idx: number, patch: Partial<TokenStep>) => {
    const next = steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange({ steps: next });
  };

  const addStep = () => {
    onChange({ steps: [...steps, emptyStep(steps.length)] });
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    onChange({ steps: steps.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-muted">
        Execute N requests in order. Each step extracts one value (JSONPath) that
        later steps can reference via <span className="font-mono">{'{{stepName}}'}</span> in
        URLs, headers, or body values. The last step&apos;s extracted value becomes
        the bearer token.
      </p>

      <div className="flex items-start gap-2">
        <input
          id="qaapi-token-chain-insecure"
          type="checkbox"
          checked={chain.insecureTls ?? false}
          onChange={(e) => onChange({ ...chain, insecureTls: e.target.checked })}
          className="mt-0.5 cursor-pointer"
        />
        <label htmlFor="qaapi-token-chain-insecure" className="cursor-pointer">
          <span className="block text-xs text-text">Allow insecure TLS</span>
          <span className="block mt-0.5 text-[11px] text-text-muted">
            Bypass cert verification for every step. Use for dev endpoints with
            self-signed or untrusted certs. Never enable against production.
          </span>
        </label>
      </div>

      {steps.map((step, idx) => (
        <div key={idx} className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-muted">#{idx + 1}</span>
            <input
              type="text"
              value={step.name}
              onChange={(e) => updateStep(idx, { name: e.target.value })}
              placeholder="stepName"
              className="flex-1 bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none font-mono"
            />
            <button
              onClick={() => removeStep(idx)}
              disabled={steps.length <= 1}
              className="px-1.5 py-0.5 text-xs text-text-muted hover:text-red disabled:opacity-30 transition-colors"
              title="Remove step"
            >
              &times;
            </button>
          </div>

          <div className="flex gap-2">
            <select
              value={step.method}
              onChange={(e) => updateStep(idx, { method: e.target.value as TokenStep['method'] })}
              className="bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none"
            >
              <option value="POST" className="bg-surface2 text-text">POST</option>
              <option value="GET" className="bg-surface2 text-text">GET</option>
            </select>
            <input
              type="text"
              value={step.url}
              onChange={(e) => updateStep(idx, { url: e.target.value })}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          <KeyValueList
            label="Headers"
            entries={step.headers ?? {}}
            onChange={(headers) => updateStep(idx, { headers })}
          />

          <div>
            <label className="block text-[11px] text-text-muted mb-1">Body</label>
            <select
              value={step.bodyType}
              onChange={(e) => updateStep(idx, { bodyType: e.target.value as TokenStep['bodyType'] })}
              className="bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none mb-1"
            >
              <option value="json" className="bg-surface2 text-text">JSON (key/value)</option>
              <option value="form" className="bg-surface2 text-text">form-urlencoded</option>
              <option value="raw" className="bg-surface2 text-text">Raw (typed JSON / other)</option>
              <option value="none" className="bg-surface2 text-text">None</option>
            </select>

            {(step.bodyType === 'json' || step.bodyType === 'form') && (
              <KeyValueList
                entries={step.body ?? {}}
                onChange={(body) => updateStep(idx, { body })}
              />
            )}

            {step.bodyType === 'raw' && (
              <div>
                <textarea
                  value={step.bodyRaw ?? ''}
                  onChange={(e) => updateStep(idx, { bodyRaw: e.target.value })}
                  placeholder={'{\n  "user": 13,\n  "tenant": "{{step1}}"\n}'}
                  rows={6}
                  className="w-full bg-surface2 text-text text-xs px-2 py-1.5 rounded border border-border focus:border-accent outline-none font-mono"
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  Sent as-is. Numbers, booleans, and nested objects are preserved.
                  Use <span className="font-mono">{'{{stepName}}'}</span> to inject
                  values from earlier steps. Content-Type defaults to
                  <span className="font-mono"> application/json</span> — override via Headers if needed.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-text-muted mb-1">
              Extract (JSONPath from response)
            </label>
            <input
              type="text"
              value={step.extract}
              onChange={(e) => updateStep(idx, { extract: e.target.value })}
              placeholder="$.access_token"
              className={inputClass}
            />
          </div>
        </div>
      ))}

      <button
        onClick={addStep}
        className="text-[11px] text-accent hover:text-accent/80 transition-colors"
      >
        + Add step
      </button>
    </div>
  );
}

/* ---- Key / value pair editor ---------------------------------------- */

interface KVProps {
  label?: string;
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
}

function KeyValueList({ label, entries, onChange }: Readonly<KVProps>) {
  const rows = Object.entries(entries);
  const displayRows = rows.length === 0 ? [['', '']] : rows;

  const update = (idx: number, key: string, value: string) => {
    const next: Record<string, string> = {};
    displayRows.forEach(([k, v], i) => {
      const finalKey = i === idx ? key : k;
      const finalValue = i === idx ? value : v;
      if (finalKey) next[finalKey] = finalValue;
    });
    onChange(next);
  };

  const remove = (idx: number) => {
    const next: Record<string, string> = {};
    displayRows.forEach(([k, v], i) => {
      if (i === idx) return;
      if (k) next[k] = v;
    });
    onChange(next);
  };

  const add = () => {
    // Add an empty row — onChange is deferred until the user types a key
    onChange({ ...entries, '': '' });
  };

  return (
    <div>
      {label && <label className="block text-[11px] text-text-muted mb-1">{label}</label>}
      <div className="space-y-1">
        {displayRows.map(([k, v], idx) => (
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
      </div>
      <button
        onClick={add}
        className="mt-1 text-[11px] text-accent hover:text-accent/80 transition-colors"
      >
        + Add
      </button>
    </div>
  );
}
