import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  VsCodeApi,
  ExtensionToWebviewMessage,
  QAAPIConfig,
  AuthConfig,
  TestSuite,
  StepResult,
  RunResult,
  Environment,
} from './types';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import Settings from './components/Settings';

interface AppProps {
  vscode: VsCodeApi;
}

export default function App({ vscode }: AppProps) {
  const [config, setConfig] = useState<QAAPIConfig | null>(null);
  const [environments, setEnvironments] = useState<Record<string, Environment>>({});
  const [activeEnv, setActiveEnv] = useState('');
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [apiLatency, setApiLatency] = useState<number | undefined>();
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');
  const [genProgress, setGenProgress] = useState(0);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [runResults, setRunResults] = useState<RunResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [authReady, setAuthReady] = useState<boolean | null>(null);
  const [authStrategy, setAuthStrategy] = useState('none');
  const [genStartTime, setGenStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleMessage = useCallback((event: MessageEvent<ExtensionToWebviewMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'CONFIG_LOADED':
        setConfig(msg.config);
        break;
      case 'AUTH_CONFIG_LOADED':
        setAuthConfig(msg.config);
        break;
      case 'ENVIRONMENTS_LOADED':
        setEnvironments(msg.environments);
        setActiveEnv(msg.active);
        break;
      case 'TEST_SUITES_LOADED':
        setSuites(msg.suites);
        setGenerating(false);
        if (!selectedSuiteId && msg.suites.length > 0) {
          setSelectedSuiteId(msg.suites[0].id);
        }
        break;
      case 'GENERATION_PROGRESS':
        if (!generating) {
          setGenerating(true);
          setGenStartTime(Date.now());
        }
        setGenMessage(msg.message);
        setGenProgress(msg.progress);
        if (msg.progress >= 100) {
          setGenerating(false);
          setGenStartTime(null);
        }
        break;
      case 'TEST_STEP_UPDATE':
        setStepResults(prev => {
          const idx = prev.findIndex(
            r => r.stepId === msg.result.stepId,
          );
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.result;
            return next;
          }
          return [...prev, msg.result];
        });
        break;
      case 'RUN_COMPLETE':
        setRunResults(prev => [...prev, msg.result]);
        break;
      case 'AUTH_STATUS':
        setAuthReady(msg.ready);
        setAuthStrategy(msg.strategy);
        break;
      case 'API_STATUS':
        setApiReachable(msg.reachable);
        setApiLatency(msg.latency);
        break;
      case 'ERROR':
        setError(msg.message);
        setTimeout(() => setError(null), 5000);
        break;
    }
  }, [selectedSuiteId]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'READY' });
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage, vscode]);

  const selectedSuite = suites.find(s => s.id === selectedSuiteId) ?? null;
  const selectedJourney = selectedSuite?.journeys.find(j => j.id === selectedJourneyId) ?? null;

  // Elapsed timer for generation
  useEffect(() => {
    if (genStartTime) {
      setElapsed(0);
      elapsedRef.current = setInterval(() => {
        setElapsed(Math.round((Date.now() - genStartTime) / 1000));
      }, 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [genStartTime]);

  const handleGenerate = () => {
    setStepResults([]);
    setRunResults([]);
    vscode.postMessage({ type: 'GENERATE_TESTS', force: true });
  };

  const handleCancel = () => {
    vscode.postMessage({ type: 'CANCEL_GENERATION' });
    setGenerating(false);
    setGenStartTime(null);
  };

  const handleRunAll = () => {
    setStepResults([]);
    setRunResults([]);
    vscode.postMessage({ type: 'RUN_TESTS' });
  };

  const handleRunJourney = (suiteId: string, journeyId: string) => {
    setStepResults([]);
    setRunResults([]);
    vscode.postMessage({ type: 'RUN_TESTS', suiteId, journeyId });
  };

  const handleRunStep = (suiteId: string, journeyId: string, stepId: string) => {
    setStepResults(prev => prev.filter(r => r.stepId !== stepId));
    setRunResults([]);
    vscode.postMessage({ type: 'RUN_TESTS', suiteId, journeyId, stepId });
  };

  const handleSelectJourney = (suiteId: string, journeyId: string) => {
    setSelectedSuiteId(suiteId);
    setSelectedJourneyId(journeyId);
    setStepResults([]);
  };

  const handleSaveConfig = (updated: QAAPIConfig) => {
    vscode.postMessage({ type: 'UPDATE_CONFIG', config: updated });
    setShowSettings(false);
  };

  const handleSaveAuth = (config: AuthConfig) => {
    setAuthConfig(config);
    vscode.postMessage({ type: 'SET_AUTH', config });
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar
        environments={environments}
        activeEnv={activeEnv}
        apiReachable={apiReachable}
        apiLatency={apiLatency}
        authReady={authReady}
        authStrategy={authStrategy}
        generating={generating}
        genProgress={genProgress}
        onSetEnvironment={(name) => vscode.postMessage({ type: 'SET_ENVIRONMENT', name })}
        onGenerate={handleGenerate}
        onRunAll={handleRunAll}
        onOpenSettings={() => setShowSettings(true)}
      />

      {error && (
        <div className="bg-red/10 border border-red text-red px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {generating && (
        <div className="px-4 py-2 bg-surface border-b border-border">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full bg-accent animate-pulse flex-shrink-0" />
            <span className="text-text-muted flex-1">{genMessage}</span>
            <span className="text-text-muted font-mono text-xs tabular-nums">{elapsed}s</span>
            <button
              onClick={handleCancel}
              className="px-2 py-0.5 text-xs text-red border border-red/30 rounded hover:bg-red/10 transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="mt-1.5 h-1 bg-surface2 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: genProgress < 30 ? '100%' : `${genProgress}%`,
                background: genProgress < 30
                  ? 'linear-gradient(90deg, transparent, var(--accent), transparent)'
                  : 'var(--accent)',
                animation: genProgress < 30 ? 'shimmer 1.5s infinite' : 'none',
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <Sidebar
          suites={suites}
          selectedSuiteId={selectedSuiteId}
          selectedJourneyId={selectedJourneyId}
          runResults={runResults}
          onSelect={handleSelectJourney}
          onRunJourney={handleRunJourney}
        />
        <MainPanel
          journey={selectedJourney}
          suiteId={selectedSuiteId}
          stepResults={stepResults}
          runResults={runResults.filter(
            r => r.journeyId === selectedJourneyId,
          )}
          onRunJourney={handleRunJourney}
          onRunStep={handleRunStep}
        />
      </div>

      {showSettings && (
        <Settings
          config={config}
          authConfig={authConfig}
          onSave={handleSaveConfig}
          onSaveAuth={handleSaveAuth}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
