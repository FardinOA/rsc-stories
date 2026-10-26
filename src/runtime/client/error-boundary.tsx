import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import type { NavigationSignal } from '../../shared/global';
import { parseNavigationDigest } from '../mock/next';
import { canvasState, post } from './channel';

interface Props {
  children: ReactNode;
  /** Changes on every server render; a new render clears a previous error. */
  resetKey: string;
}

interface State {
  error: (Error & { digest?: string }) | null;
  resetKey: string;
}

// The card sits inside the user's own page, so it inherits their colour and only sets structure.
const card: CSSProperties = {
  font: '13px/1.5 ui-sans-serif, system-ui, sans-serif',
  border: '1px solid',
  borderRadius: 4,
  padding: '12px 16px',
  margin: 0,
  maxWidth: 880,
};

function NavigationView({ signal }: { signal: NavigationSignal }) {
  const call = signal.url !== undefined ? `${signal.type}(${JSON.stringify(signal.url)})` : `${signal.type}()`;
  const outcome = signal.type.toLowerCase().includes('redirect')
    ? `navigate to ${signal.url ?? 'another page'}`
    : `render the nearest ${signal.type === 'notFound' ? 'not-found' : signal.type} boundary`;
  return (
    <section
      role="status"
      data-rsc-stories-navigation={signal.type}
      style={{ ...card, borderColor: 'rgba(110,116,128,0.6)', background: 'rgba(110,116,128,0.08)' }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>Navigation intercepted</strong>
      <code>{call}</code> was called while rendering this story. In the app this would {outcome}.
    </section>
  );
}

function ErrorView({ error }: { error: Error & { digest?: string } }) {
  return (
    <section
      role="alert"
      data-rsc-stories-error=""
      style={{ ...card, borderColor: 'rgba(200,52,52,0.7)', background: 'rgba(200,52,52,0.07)' }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>
        Error: {error.name && error.name !== 'Error' ? `${error.name} ` : ''}while rendering the story
      </strong>
      <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{error.message}</p>
      {error.digest ? (
        <p style={{ margin: '0 0 8px', opacity: 0.8 }}>
          Digest <code>{error.digest}</code>. The server log in the Console panel has the full stack.
        </p>
      ) : null}
      {error.stack ? (
        <details>
          <summary>Stack trace</summary>
          <pre style={{ overflow: 'auto', fontSize: 12, margin: '8px 0 0' }}>{error.stack}</pre>
        </details>
      ) : null}
    </section>
  );
}

/** Catches server and client render errors so one failing story never blanks the canvas. */
export class StoryErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error & { digest?: string }, info: ErrorInfo): void {
    const navigation = parseNavigationDigest(error.digest);
    const stack = [error.stack, info.componentStack ? `Component stack:${info.componentStack}` : ''].filter(Boolean).join('\n\n');
    post({
      type: 'error',
      renderId: canvasState().renderId ?? this.props.resetKey,
      message: error.message,
      ...(stack ? { stack } : {}),
      ...(error.digest ? { digest: error.digest } : {}),
      ...(navigation ? { navigation } : {}),
    });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const navigation = parseNavigationDigest(error.digest);
    return navigation ? <NavigationView signal={navigation} /> : <ErrorView error={error} />;
  }
}
