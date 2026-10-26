import { useEffect, useState } from 'react';
import { config } from '../lib/api';
import { desiredCanvasUrl, postToCanvas, rerun, selection, setGlobal } from '../lib/actions';
import { titleParts } from '../lib/format';
import { store, useStore, type Theme } from '../lib/store';
import { Icon } from './primitives';

const DEFAULT_BACKGROUNDS = [
  { name: 'Light', value: '#ffffff' },
  { name: 'Dark', value: '#16181c' },
  { name: 'Gray', value: '#f1f2f4' },
];

function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('rsc-stories:theme', theme);
  } catch {
    // storage blocked
  }
}

export function Toolbar() {
  const storyId = useStore((s) => s.storyId);
  const index = useStore((s) => s.index);
  const descriptors = useStore((s) => s.descriptors);
  const viewport = useStore((s) => s.viewport);
  const rotate = useStore((s) => s.rotate);
  const theme = useStore((s) => s.theme);
  const overlays = useStore((s) => s.overlays);
  const background = useStore((s) => s.story.globals?.background);
  const [copied, setCopied] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => postToCanvas({ type: 'overlays', ...overlays }), [overlays, storyId]);

  const sel = selection();
  void index;
  void descriptors;
  const parts = sel ? titleParts(sel.file.title) : [];
  const params = sel?.descriptor?.parameters as { backgrounds?: { values?: Array<{ name: string; value: string }> } } | undefined;
  const backgrounds = params?.backgrounds?.values ?? DEFAULT_BACKGROUNDS;
  const viewports = config.viewports;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the address bar holds the same link
    }
  };

  const nextTheme: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const canvasHref = desiredCanvasUrl();

  return (
    <header className="toolbar">
      <button
        type="button"
        className="btn only-narrow"
        aria-label="Show stories"
        onClick={() => store.set((s) => ({ sidebarOpen: !s.sidebarOpen }))}
      >
        <Icon name="menu" />
      </button>
      <h1>
        {sel ? (
          <>
            <span className="crumbs">
              {parts.slice(0, -1).join(' / ')}
              {parts.length > 1 ? ' / ' : ''}
            </span>
            {parts[parts.length - 1]} <span className="crumbs">·</span> {sel.story.name}
          </>
        ) : (
          'No story selected'
        )}
      </h1>
      <span className="spacer" />
      <div className="toolbar-group">
        <label htmlFor="viewport" className="sr-only">
          Viewport
        </label>
        <select id="viewport" className="select" value={viewport} onChange={(event) => store.set({ viewport: event.target.value })}>
          <option value="responsive">Responsive</option>
          {Object.entries(viewports).map(([key, vp]) => (
            <option key={key} value={key}>
              {vp.name} {vp.width}×{vp.height}
            </option>
          ))}
          <option value="custom">Custom (drag the corner)</option>
        </select>
        <button
          type="button"
          className="btn"
          aria-pressed={rotate}
          aria-label="Rotate viewport"
          title="Rotate viewport"
          disabled={viewport === 'responsive' || viewport === 'custom'}
          onClick={() => store.set((s) => ({ rotate: !s.rotate }))}
        >
          <Icon name="rotate" />
        </button>
      </div>
      <div className="toolbar-group">
        <label htmlFor="background" className="sr-only">
          Canvas background
        </label>
        <select
          id="background"
          className="select"
          value={typeof background === 'string' ? background : ''}
          disabled={config.static}
          onChange={(event) => setGlobal('background', event.target.value || undefined)}
        >
          <option value="">Background: story default</option>
          {backgrounds.map((bg) => (
            <option key={bg.name} value={bg.name}>
              Background: {bg.name}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-group" role="group" aria-label="Canvas overlays">
        <button
          type="button"
          className="btn"
          aria-pressed={overlays.suspense}
          title="Outline Suspense boundaries"
          onClick={() => store.set((s) => ({ overlays: { ...s.overlays, suspense: !s.overlays.suspense } }))}
        >
          <Icon name="outline" />
          <span className="sr-only">Outline Suspense boundaries</span>
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={overlays.measure}
          title="Measure box model on hover"
          onClick={() => store.set((s) => ({ overlays: { ...s.overlays, measure: !s.overlays.measure } }))}
        >
          <Icon name="ruler" />
          <span className="sr-only">Measure box model on hover</span>
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          className="btn outline"
          onClick={rerun}
          disabled={!sel || config.static}
          title="Run the server render again with the same args and mocks"
        >
          <Icon name="refresh" />
          Re-run server render
        </button>
        <button type="button" className="btn" onClick={copyLink} title="Copy link to this story, args and mocks">
          <Icon name={copied ? 'check' : 'link'} />
          <span className="sr-only">{copied ? 'Link copied' : 'Copy link'}</span>
        </button>
        {canvasHref ? (
          <a className="btn" href={canvasHref} target="_blank" rel="noreferrer" title="Open the canvas in a new tab">
            <Icon name="external" />
            <span className="sr-only">Open canvas in a new tab</span>
          </a>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => store.set((s) => ({ theme: nextTheme[s.theme] }))}
          title={`Workshop theme: ${theme}`}
        >
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
          <span className="sr-only">Workshop theme: {theme}. Activate to change.</span>
        </button>
      </div>
    </header>
  );
}
