import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { loadIndex, selectStory, startChannels } from './lib/actions';
import { readLocation, startUrlSync } from './lib/url';
import { store, useStore } from './lib/store';
import { Canvas } from './components/Canvas';
import { TabPanel, Tabs, type TabItem } from './components/primitives';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ControlsPanel } from './panels/Controls';
import { MocksPanel } from './panels/Mocks';
import { InspectorPanel } from './panels/Inspector';
import { A11yPanel, CallsPanel, ConsolePanel, InteractionsPanel } from './panels/Activity';
import { AddonPanelView, addonPanels, loadAddons } from './panels/Addons';

function Splitter() {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const main = event.currentTarget.parentElement;
    if (!main) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const iframe = main.querySelector('iframe');
    if (iframe) iframe.style.pointerEvents = 'none';
    const move = (e: globalThis.PointerEvent) => {
      const rect = main.getBoundingClientRect();
      const fraction = Math.min(0.85, Math.max(0.12, (rect.bottom - e.clientY) / rect.height));
      main.style.setProperty('--panel-height', `${Math.round(fraction * 100)}%`);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (iframe) iframe.style.pointerEvents = '';
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const [value, setValue] = useState(38);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = Math.min(85, Math.max(12, value + delta));
    setValue(next);
    event.currentTarget.parentElement?.style.setProperty('--panel-height', `${next}%`);
  };
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panels"
      aria-valuemin={12}
      aria-valuemax={85}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

function PanelArea() {
  const panel = useStore((s) => s.panel);
  const record = useStore((s) => s.record);
  const report = useStore((s) => s.report);
  const clientLogs = useStore((s) => s.clientLogs);
  const events = useStore((s) => s.events);
  const play = useStore((s) => s.play);
  const a11y = useStore((s) => s.a11y);
  const [, rerender] = useState(0);
  useEffect(() => {
    void loadAddons().then(() => rerender((n) => n + 1));
  }, []);

  const serverErrors = (record?.logs ?? []).filter((l) => l.level === 'error').length;
  const clientErrors = clientLogs.filter((l) => l.level === 'error').length;
  const warnings = record?.warnings.length ?? 0;
  const problems =
    (report?.nonSerializable.filter((n) => n.severity === 'error').length ?? 0) + (report?.budgets.filter((b) => !b.ok).length ?? 0);
  const items: TabItem[] = [
    { id: 'controls', label: 'Controls' },
    { id: 'mocks', label: 'Mocks', ...(warnings ? { badge: { value: warnings, tone: 'warning' as const } } : {}) },
    { id: 'inspector', label: 'Inspector', ...(problems ? { badge: { value: problems, tone: 'error' as const } } : {}) },
    {
      id: 'console',
      label: 'Console',
      ...(serverErrors + clientErrors ? { badge: { value: serverErrors + clientErrors, tone: 'error' as const } } : {}),
    },
    { id: 'calls', label: 'Calls', badge: { value: (record?.calls.length ?? 0) + events.filter((e) => e.name !== 'prefetch').length } },
    {
      id: 'interactions',
      label: 'Interactions',
      ...(play?.status === 'failed' ? { badge: { value: '!', tone: 'error' as const } } : {}),
    },
    {
      id: 'a11y',
      label: 'Accessibility',
      ...(a11y?.result?.violations.length ? { badge: { value: a11y.result.violations.length, tone: 'error' as const } } : {}),
    },
    ...addonPanels().map((p) => ({ id: `addon:${p.id}`, label: p.title })),
  ];
  const addon = addonPanels().find((p) => `addon:${p.id}` === panel);
  return (
    <section className="panels" aria-label="Story panels">
      <Tabs items={items} selected={panel} onSelect={(id) => store.set({ panel: id })} label="Story panels" idPrefix="panel" />
      <TabPanel idPrefix="panel" id={panel}>
        {panel === 'controls' ? <ControlsPanel /> : null}
        {panel === 'mocks' ? <MocksPanel /> : null}
        {panel === 'inspector' ? <InspectorPanel /> : null}
        {panel === 'console' ? <ConsolePanel /> : null}
        {panel === 'calls' ? <CallsPanel /> : null}
        {panel === 'interactions' ? <InteractionsPanel /> : null}
        {panel === 'a11y' ? <A11yPanel /> : null}
        {addon ? <AddonPanelView panel={addon} /> : null}
      </TabPanel>
    </section>
  );
}

export function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  useEffect(() => {
    const initial = readLocation();
    const { storyId, ...rest } = initial;
    store.set(rest);
    if (storyId) selectStory(storyId, { keepState: true });
    const stopUrl = startUrlSync((id) => selectStory(id, { keepState: true }));
    const stopChannels = startChannels();
    void loadIndex();
    return () => {
      stopUrl();
      stopChannels();
    };
  }, []);
  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <a href="#canvas" className="skip-link">
        Skip to canvas
      </a>
      <Sidebar />
      <main className="main">
        <Toolbar />
        <Canvas />
        <Splitter />
        <PanelArea />
      </main>
    </div>
  );
}
