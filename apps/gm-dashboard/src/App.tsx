import { useEffect, useState } from 'react';
import { fetchState, fetchRecentTranscript, type OrchestratorState, type TranscriptLine } from './api';

const POLL_INTERVAL_MS = 3_000;

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function App(): JSX.Element {
  const [sessionId, setSessionId] = useState('');
  const [state, setState] = useState<OrchestratorState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const nextState = await fetchState();
        if (cancelled) return;
        setState(nextState);
        setStatus('connected');
      } catch {
        if (!cancelled) setStatus('disconnected');
      }

      if (sessionId) {
        const lines = await fetchRecentTranscript(sessionId).catch(() => []);
        if (!cancelled) setTranscript(lines);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>RPG-Assistant — Dashboard MJ</h1>
        <ConnectionBadge status={status} />
      </header>

      <label className="dashboard__session-input">
        ID de session (pour la transcription) :
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="ex: a1b2c3d4-..." />
      </label>

      <div className="dashboard__grid">
        <Panel title="Scène & Ambiance">
          <p>
            <strong>Scène :</strong> {state?.scene || '—'}
          </p>
          <p>
            <strong>Ambiance :</strong> {state?.mood || '—'}
          </p>
        </Panel>

        <Panel title="Conseil MJ">
          {state?.lastGmTip ? (
            <p className={`tip tip--${state.lastGmTip.priority}`}>{state.lastGmTip.text}</p>
          ) : (
            <p className="empty">Aucun conseil pour le moment.</p>
          )}
        </Panel>

        <Panel title="Image active">
          {state?.activeImage ? (
            <p>
              {state.activeImage.query} <span className="source">({state.activeImage.source})</span>
            </p>
          ) : (
            <p className="empty">Aucune image active.</p>
          )}
        </Panel>

        <Panel title="Musique active">
          {state?.activeMusic ? (
            <p>{state.activeMusic.track}</p>
          ) : (
            <p className="empty">Aucune musique active.</p>
          )}
        </Panel>

        <Panel title="Transcription récente" className="dashboard__panel--wide">
          {transcript.length === 0 ? (
            <p className="empty">
              {sessionId ? 'Aucune ligne pour cette session.' : 'Saisissez un ID de session ci-dessus.'}
            </p>
          ) : (
            <ul className="transcript">
              {transcript.map((line) => (
                <li key={line.id}>
                  {line.isGM && <strong>MJ </strong>}
                  <strong>{line.displayName} :</strong> {line.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`panel ${className ?? ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus; }): JSX.Element {
  const label = status === 'connected' ? 'Orchestrateur connecté' : status === 'connecting' ? 'Connexion…' : 'Orchestrateur injoignable';
  return <span className={`badge badge--${status}`}>{label}</span>;
}
