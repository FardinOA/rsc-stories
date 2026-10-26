// @vitest-environment jsdom
import { act, createContext, useContext, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasState, installCanvasChannel, onWorkshopMessage, post } from '../../src/runtime/client/channel';
import { ClientArgs } from '../../src/runtime/client/client-args';
import { StoryErrorBoundary } from '../../src/runtime/client/error-boundary';
import { createNavigationMock } from '../../src/runtime/client/navigation';
import { StoryNavigationError } from '../../src/runtime/mock/next';
import { isEnvelope, MESSAGE_SOURCE } from '../../src/shared/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  canvasState().messages.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const messages = () => canvasState().messages;

describe('StoryErrorBoundary', () => {
  it('shows errors and reports them; a new render id clears them', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Throws = (): ReactNode => {
      throw Object.assign(new Error('kaboom'), { digest: '123' });
    };
    act(() =>
      root.render(
        <StoryErrorBoundary resetKey="a">
          <Throws />
        </StoryErrorBoundary>,
      ),
    );
    expect(container.textContent).toContain('kaboom');
    expect(container.textContent).toContain('123');
    expect(messages().find((m) => m.type === 'error')).toMatchObject({ message: 'kaboom', digest: '123' });
    act(() =>
      root.render(
        <StoryErrorBoundary resetKey="b">
          <p>fine</p>
        </StoryErrorBoundary>,
      ),
    );
    expect(container.textContent).toBe('fine');
  });

  it('renders mocked navigation as a notice', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Redirects = (): ReactNode => {
      throw new StoryNavigationError({ type: 'redirect', url: '/login' });
    };
    act(() =>
      root.render(
        <StoryErrorBoundary resetKey="a">
          <Redirects />
        </StoryErrorBoundary>,
      ),
    );
    expect(container.querySelector('[data-rsc-stories-navigation="redirect"]')?.textContent).toContain('redirect("/login")');
    expect(messages().find((m) => m.type === 'error')).toMatchObject({ navigation: { type: 'redirect', url: '/login' } });
    const NotFound = (): ReactNode => {
      throw new StoryNavigationError({ type: 'notFound' });
    };
    act(() =>
      root.render(
        <StoryErrorBoundary resetKey="b">
          <NotFound />
        </StoryErrorBoundary>,
      ),
    );
    expect(container.textContent).toContain('not-found boundary');
  });
});

describe('ClientArgs', () => {
  it('recreates function args as logging actions', () => {
    const Button = ({ label, onClick }: { label: string; onClick: (n: number) => void }) => (
      <button onClick={() => onClick(42)}>{label}</button>
    );
    act(() => root.render(<ClientArgs component={Button as never} args={{ label: 'Save' }} actions={['onClick']} />));
    act(() => container.querySelector('button')!.click());
    expect(messages().find((m) => m.type === 'action')).toMatchObject({ name: 'onClick', args: [42] });
    const Evented = ({ onPress }: { onPress: (e: unknown) => void }) => <button onClick={(e) => onPress(e)}>x</button>;
    act(() => root.render(<ClientArgs component={Evented as never} args={{}} actions={['onPress']} />));
    act(() => container.querySelector('button')!.click());
    expect(
      messages()
        .filter((m) => m.type === 'action')
        .at(-1),
    ).toMatchObject({ args: [{ type: 'click', event: '[SyntheticEvent]' }] });
  });
});

describe('createNavigationMock (FR-3.4)', () => {
  it('provides mocked pathname, search params, params and a recording router', () => {
    const AppRouterContext = createContext<{ refresh(): void } | null>(null);
    const PathnameContext = createContext<string | null>(null);
    const SearchParamsContext = createContext<URLSearchParams | null>(null);
    const PathParamsContext = createContext<Record<string, string | string[]> | null>(null);
    const NavigationPromisesContext = createContext<unknown>('next-dev');
    const NavigationMock = createNavigationMock({
      AppRouterContext,
      PathnameContext,
      SearchParamsContext,
      PathParamsContext,
      NavigationPromisesContext,
    } as never);
    const refresh = vi.fn();
    let router: Record<string, (...a: unknown[]) => void> | null = null;
    function Probe() {
      router = useContext(AppRouterContext) as never;
      return (
        <p>
          {useContext(PathnameContext)}|{useContext(SearchParamsContext)?.toString()}|{JSON.stringify(useContext(PathParamsContext))}|
          {String(useContext(NavigationPromisesContext))}
        </p>
      );
    }
    act(() =>
      root.render(
        <AppRouterContext.Provider value={{ refresh }}>
          <NavigationMock pathname="/cart" searchParams={{ q: 'a', tag: ['x', 'y'] }} params={{ id: '1' }}>
            <Probe />
          </NavigationMock>
        </AppRouterContext.Provider>,
      ),
    );
    expect(container.textContent).toBe('/cart|q=a&tag=x&tag=y|{"id":"1"}|null');
    const r = router as unknown as Record<
      'push' | 'replace' | 'back' | 'forward' | 'prefetch' | 'refresh' | 'hmrRefresh',
      (...a: unknown[]) => void
    >;
    act(() => {
      r.push('/next', { scroll: false });
      r.replace('/r');
      r.back();
      r.forward();
      r.prefetch('/p');
      r.refresh();
      r.hmrRefresh();
    });
    expect(refresh).toHaveBeenCalled();
    expect(
      messages()
        .filter((m) => m.type === 'router')
        .map((m) => (m as { method: string }).method),
    ).toEqual(['push', 'replace', 'back', 'forward', 'prefetch', 'refresh']);
  });
});

describe('canvas channel', () => {
  it('captures console output and hydration errors, and dispatches workshop messages', async () => {
    installCanvasChannel();
    installCanvasChannel();
    const log = vi.spyOn(console, 'debug');
    console.debug('hello', { a: 1 }, new Error('e'));
    console.error('Hydration failed because the server rendered text did not match');
    console.log('%c%s%c msg', '', ' Server ', '');
    expect(log).toHaveBeenCalled();
    const logs = messages()
      .filter((m) => m.type === 'log')
      .map((m) => (m as { entry: { message: string } }).entry.message);
    expect(logs[0]).toBe('hello {"a":1} Error: e');
    expect(logs.some((m) => m.includes(' Server '))).toBe(false);
    expect(messages().some((m) => m.type === 'hydration-mismatch')).toBe(true);
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    expect(logs.length).toBeLessThan(messages().filter((m) => m.type === 'log').length);
    const received: unknown[] = [];
    const off = onWorkshopMessage((message) => received.push(message));
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: MESSAGE_SOURCE, type: 'refresh' }, origin: window.location.origin }),
    );
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'refresh' }, origin: window.location.origin }));
    window.dispatchEvent(new MessageEvent('message', { data: { source: MESSAGE_SOURCE, type: 'refresh' }, origin: 'https://evil.test' }));
    off();
    expect(received).toEqual([{ source: MESSAGE_SOURCE, type: 'refresh' }]);
    for (let i = 0; i < 510; i++) post({ type: 'router', method: 'push', args: [], time: i });
    expect(messages().length).toBe(500);
    expect(isEnvelope({ source: MESSAGE_SOURCE, type: 'x' })).toBe(true);
    expect(isEnvelope({ type: 'x' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
});
