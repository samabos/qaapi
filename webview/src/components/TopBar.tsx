import type { Environment } from '../types';

interface TopBarProps {
  environments: Record<string, Environment>;
  activeEnv: string;
  apiReachable: boolean | null;
  apiLatency?: number;
  authReady: boolean | null;
  authStrategy: string;
  generating: boolean;
  genProgress: number;
  onSetEnvironment: (name: string) => void;
  onGenerate: () => void;
  onRunAll: () => void;
  onOpenSettings: () => void;
}

export default function TopBar({
  environments,
  activeEnv,
  apiReachable,
  apiLatency,
  authReady,
  authStrategy,
  generating,
  onSetEnvironment,
  onGenerate,
  onRunAll,
  onOpenSettings,
}: TopBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface border-b border-border">
      {/* Logo */}
      <span className="font-mono font-bold text-accent text-sm tracking-wide">QAAPI</span>

      <div className="w-px h-5 bg-border" />

      {/* Environment selector */}
      <select
        value={activeEnv}
        onChange={(e) => onSetEnvironment(e.target.value)}
        className="bg-surface2 text-text text-xs px-2 py-1 rounded border border-border focus:border-accent outline-none"
      >
        {Object.keys(environments).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {/* API status */}
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <span
          className={`w-2 h-2 rounded-full ${
            apiReachable === null
              ? 'bg-yellow'
              : apiReachable
                ? 'bg-green'
                : 'bg-red'
          }`}
        />
        {apiReachable === null
          ? 'Checking...'
          : apiReachable
            ? `Online${apiLatency ? ` (${apiLatency}ms)` : ''}`
            : 'Offline'}
      </div>

      {/* Auth status */}
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <span
          className={`w-2 h-2 rounded-full ${
            authReady === null
              ? 'bg-text-muted/40'
              : authReady
                ? 'bg-green'
                : 'bg-red'
          }`}
        />
        {authReady === null
          ? 'No Auth'
          : authReady
            ? authStrategy
            : authStrategy}
      </div>

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="px-2 py-1 text-xs text-text-muted hover:text-text transition-colors"
        title="Project Settings"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492ZM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0Z"/>
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319Zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116l.094-.318Z"/>
        </svg>
      </button>

      {/* Actions */}
      <button
        onClick={onGenerate}
        disabled={generating}
        className="px-3 py-1 text-xs font-medium rounded bg-surface2 text-text border border-border hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {generating ? 'Generating...' : 'Generate'}
      </button>

      <button
        onClick={onRunAll}
        disabled={generating}
        className="px-3 py-1 text-xs font-medium rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Run All
      </button>
    </div>
  );
}
