/**
 * Canvas overlays drawn outside React's tree (FR-4.10): dashed outlines around Suspense boundaries
 * and a box-model readout for the hovered element. Neutral ink only; the overlay never intercepts
 * pointer events.
 */

const LAYER_ID = 'rsc-stories-overlay';

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LAYER_ID;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  return el;
}

function box(rect: DOMRect, style: Partial<CSSStyleDeclaration>, label?: string): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: 'border-box',
    ...style,
  });
  if (label) {
    const tag = document.createElement('span');
    tag.textContent = label;
    Object.assign(tag.style, {
      position: 'absolute',
      top: '-18px',
      left: '0',
      font: '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
      padding: '0 4px',
      background: 'rgba(32,34,38,0.9)',
      color: '#fff',
      borderRadius: '2px',
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    el.appendChild(tag);
  }
  return el;
}

/** Start/end comment pairs React leaves around Suspense boundaries (`<!--$-->` … `<!--/$-->`). */
function suspenseRanges(root: Element): Array<{ range: Range; state: string }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const stack: Comment[] = [];
  const ranges: Array<{ range: Range; state: string }> = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const comment = node as Comment;
    if (comment.data === '$' || comment.data === '$?' || comment.data === '$!' || comment.data === '&') {
      stack.push(comment);
    } else if (comment.data === '/$' || comment.data === '/&') {
      const start = stack.pop();
      if (!start) continue;
      const range = document.createRange();
      range.setStartAfter(start);
      range.setEndBefore(comment);
      ranges.push({
        range,
        state: start.data === '$?' ? 'pending' : start.data === '$!' ? 'client-rendered' : 'resolved',
      });
    }
  }
  return ranges;
}

let measureHandler: ((event: MouseEvent) => void) | null = null;
let suspenseEnabled = false;
let observer: MutationObserver | null = null;
let frame = 0;

function drawSuspense(): void {
  const el = layer();
  for (const child of [...el.querySelectorAll('[data-overlay="suspense"]')]) child.remove();
  if (!suspenseEnabled) return;
  const root = document.querySelector('[data-rsc-stories-canvas]');
  if (!root) return;
  for (const { range, state } of suspenseRanges(root)) {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const outline = box(rect, { border: '1px dashed rgba(90,96,108,0.9)', background: 'rgba(90,96,108,0.04)' }, `Suspense · ${state}`);
    outline.dataset.overlay = 'suspense';
    el.appendChild(outline);
  }
}

function scheduleSuspense(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(drawSuspense);
}

function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

function drawMeasure(target: Element): void {
  const el = layer();
  for (const child of [...el.querySelectorAll('[data-overlay="measure"]')]) child.remove();
  const rect = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  const margin = new DOMRect(
    rect.left - px(cs.marginLeft),
    rect.top - px(cs.marginTop),
    rect.width + px(cs.marginLeft) + px(cs.marginRight),
    rect.height + px(cs.marginTop) + px(cs.marginBottom),
  );
  const content = new DOMRect(
    rect.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
    rect.top + px(cs.borderTopWidth) + px(cs.paddingTop),
    rect.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(cs.paddingLeft) - px(cs.paddingRight),
    rect.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(cs.paddingTop) - px(cs.paddingBottom),
  );
  const parts = [
    box(margin, { border: '1px dotted rgba(90,96,108,0.8)' }),
    box(
      rect,
      { border: '1px solid rgba(32,34,38,0.85)', background: 'rgba(90,96,108,0.10)' },
      `${target.tagName.toLowerCase()} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
    ),
    box(content, { background: 'rgba(90,96,108,0.18)' }),
  ];
  for (const part of parts) {
    part.dataset.overlay = 'measure';
    el.appendChild(part);
  }
}

/** Turns the overlays on or off. Safe to call repeatedly. */
export function setOverlays(options: { suspense: boolean; measure: boolean }): void {
  suspenseEnabled = options.suspense;
  if (suspenseEnabled && !observer) {
    observer = new MutationObserver(scheduleSuspense);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', scheduleSuspense);
    window.addEventListener('scroll', scheduleSuspense, true);
  } else if (!suspenseEnabled && observer) {
    observer.disconnect();
    observer = null;
    window.removeEventListener('resize', scheduleSuspense);
    window.removeEventListener('scroll', scheduleSuspense, true);
  }
  scheduleSuspense();

  if (options.measure && !measureHandler) {
    measureHandler = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('[data-rsc-stories-root]')) drawMeasure(target);
    };
    document.addEventListener('mousemove', measureHandler, true);
  } else if (!options.measure && measureHandler) {
    document.removeEventListener('mousemove', measureHandler, true);
    measureHandler = null;
    for (const child of [...layer().querySelectorAll('[data-overlay="measure"]')]) child.remove();
  }
}
