import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { config } from '../lib/api';
import { attachFrame, desiredCanvasUrl, frameLoaded, navigateCanvas, selection } from '../lib/actions';
import { store, useStore } from '../lib/store';
import { Empty, Icon } from './primitives';

/** The story canvas: an isolated iframe in a sizeable frame (FR-4.2). */
export function Canvas() {
  const storyId = useStore((s) => s.storyId);
  const story = useStore((s) => s.story);
  const descriptors = useStore((s) => s.descriptors);
  const index = useStore((s) => s.index);
  const viewport = useStore((s) => s.viewport);
  const rotate = useStore((s) => s.rotate);
  const customSize = useStore((s) => s.customSize);
  const renderPending = useStore((s) => s.renderPending);
  const nextStatus = useStore((s) => s.nextStatus);
  const canvasReloading = useStore((s) => s.canvasReloading);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // Stable: an inline ref callback would detach and reattach (and reload) the iframe every render.
  const setFrame = useCallback((element: HTMLIFrameElement | null) => {
    frameRef.current = element;
    attachFrame(element);
  }, []);

  void story;
  void descriptors;
  void index;
  const sel = selection();
  const url = desiredCanvasUrl();
  const fileDescriptor = sel ? store.get().descriptors[sel.file.fileKey] : undefined;
  // Wait for the descriptor so mocked searchParams are part of the very first URL.
  const ready = !!url && !!fileDescriptor;

  useEffect(() => {
    if (ready && url) navigateCanvas(url);
  }, [ready, url]);

  const preset = config.viewports[viewport];
  let width: number | undefined;
  let height: number | undefined;
  if (preset) {
    width = rotate ? preset.height : preset.width;
    height = rotate ? preset.width : preset.height;
  } else if (viewport === 'custom') {
    width = customSize?.width ?? 800;
    height = customSize?.height ?? 600;
  }
  const fill = width === undefined;

  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = width ?? areaRef.current?.clientWidth ?? 800;
    const startH = height ?? areaRef.current?.clientHeight ?? 600;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    // The iframe would swallow pointer events mid-drag.
    if (frameRef.current) frameRef.current.style.pointerEvents = 'none';
    const move = (e: globalThis.PointerEvent) => {
      store.set({
        viewport: 'custom',
        customSize: {
          width: Math.max(120, Math.round(startW + e.clientX - startX)),
          height: Math.max(120, Math.round(startH + e.clientY - startY)),
        },
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (frameRef.current) frameRef.current.style.pointerEvents = '';
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const keyResize = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 50 : 10;
    const w = width ?? areaRef.current?.clientWidth ?? 800;
    const h = height ?? areaRef.current?.clientHeight ?? 600;
    const delta: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    store.set({ viewport: 'custom', customSize: { width: Math.max(120, w + d[0]), height: Math.max(120, h + d[1]) } });
  };

  if (!storyId || !sel) {
    return (
      <div className="canvas-area" id="canvas">
        <Empty title={index ? 'Pick a story' : 'Loading stories…'}>
          {index ? <p>Choose a story in the sidebar to render it through your app's Next.js.</p> : null}
        </Empty>
      </div>
    );
  }

  return (
    <div className="canvas-area" id="canvas" ref={areaRef} data-fill={fill} tabIndex={-1}>
      {canvasReloading ? (
        <div className="canvas-banner" role="alert">
          The canvas keeps reloading (Next.js hot reload). Stop the workshop, delete <code>.rsc-stories/.cache</code> and start it again.
        </div>
      ) : config.static ? (
        <div className="canvas-banner" role="note">
          Static build: stories show their default state. Run <code>rsc-stories dev</code> to edit args and mocks.
        </div>
      ) : nextStatus !== 'ready' ? (
        <div className="canvas-banner" role="status">
          {nextStatus === 'restarting'
            ? 'Restarting Next.js…'
            : nextStatus === 'error'
              ? 'Next.js failed to start — see the terminal.'
              : 'Starting Next.js…'}
        </div>
      ) : renderPending ? (
        <div className="canvas-banner" role="status" aria-live="polite">
          Rendering on the server…
        </div>
      ) : null}
      <div className="frame" style={fill ? undefined : { width, height }}>
        <iframe ref={setFrame} title={`Canvas: ${sel.file.title} — ${sel.story.name}`} onLoad={frameLoaded} />
        {!fill ? (
          <button
            type="button"
            className="frame-resize"
            aria-label={`Resize canvas, currently ${width} by ${height}. Use arrow keys.`}
            onPointerDown={startResize}
            onKeyDown={keyResize}
          >
            <Icon name="resize" />
          </button>
        ) : null}
      </div>
      {!fill ? (
        <span className="dims" style={{ position: 'absolute', right: 12, bottom: 6 }}>
          {width}×{height}
        </span>
      ) : null}
    </div>
  );
}
