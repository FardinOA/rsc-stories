import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { IndexJson } from '../../node/indexer';
import { config } from '../lib/api';
import { selectStory } from '../lib/actions';
import { titleParts } from '../lib/format';
import { store, useStore } from '../lib/store';
import { Icon } from './primitives';

interface TreeNode {
  id: string;
  label: string;
  kind: 'group' | 'component' | 'story';
  storyId?: string;
  children: TreeNode[];
  path?: string;
  error?: string | null;
}

function buildTree(index: IndexJson): TreeNode[] {
  const roots: TreeNode[] = [];
  const groups = new Map<string, TreeNode>();
  for (const file of index.files) {
    const parts = titleParts(file.title);
    let siblings = roots;
    let key = '';
    for (const part of parts.slice(0, -1)) {
      key += `/${part}`;
      let group = groups.get(key);
      if (!group) {
        group = { id: `g:${key}`, label: part, kind: 'group', children: [] };
        groups.set(key, group);
        siblings.push(group);
      }
      siblings = group.children;
    }
    siblings.push({
      id: `c:${file.fileKey}`,
      label: parts[parts.length - 1] ?? file.title,
      kind: 'component',
      path: file.path,
      error: file.error,
      children: file.stories.map((story) => ({
        id: `s:${story.id}`,
        label: story.name,
        kind: 'story',
        storyId: story.id,
        children: [],
      })),
    });
  }
  return roots;
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const selfMatch = node.label.toLowerCase().includes(q) || (node.storyId ?? '').includes(q);
    if (selfMatch && node.kind !== 'group') {
      out.push(node);
      continue;
    }
    const children = filterTree(node.children, query);
    if (children.length) out.push({ ...node, children });
  }
  return out;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

interface FlatItem {
  node: TreeNode;
  depth: number;
  parent?: string;
  expanded: boolean;
}

/** Story navigator: an ARIA tree with search and full keyboard support (FR-4.1, FR-4.9). */
export function Sidebar() {
  const index = useStore((s) => s.index);
  const indexError = useStore((s) => s.indexError);
  const storyId = useStore((s) => s.storyId);
  const nextStatus = useStore((s) => s.nextStatus);
  const nextError = useStore((s) => s.nextError);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const typeahead = useRef({ text: '', at: 0 });

  const tree = useMemo(() => (index ? buildTree(index) : []), [index]);
  const visibleTree = useMemo(() => filterTree(tree, query.trim()), [tree, query]);

  // Groups start open; the selected story's component opens with it.
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      const walk = (nodes: TreeNode[], ancestors: string[]) => {
        for (const node of nodes) {
          if (node.kind === 'group' && !current.has(`x:${node.id}`)) next.add(node.id);
          if (node.storyId === storyId) for (const id of ancestors) next.add(id);
          walk(node.children, [...ancestors, node.id]);
        }
      };
      walk(tree, []);
      return next;
    });
  }, [tree, storyId]);

  const flat = useMemo(() => {
    const items: FlatItem[] = [];
    const walk = (nodes: TreeNode[], depth: number, parent?: string) => {
      for (const node of nodes) {
        const isOpen = query ? true : expanded.has(node.id);
        items.push({ node, depth, ...(parent ? { parent } : {}), expanded: isOpen });
        if (node.children.length && isOpen) walk(node.children, depth + 1, node.id);
      }
    };
    walk(visibleTree, 0);
    return items;
  }, [visibleTree, expanded, query]);

  const selectedNodeId = storyId ? `s:${storyId}` : undefined;
  const activeId =
    focused && flat.some((i) => i.node.id === focused)
      ? focused
      : selectedNodeId && flat.some((i) => i.node.id === selectedNodeId)
        ? selectedNodeId
        : flat[0]?.node.id;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusItem = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    itemRefs.current.get(id)?.focus();
  };

  const toggle = (id: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      const willOpen = open ?? !next.has(id);
      if (willOpen) {
        next.add(id);
        next.delete(`x:${id}`);
      } else {
        next.delete(id);
        next.add(`x:${id}`);
      }
      return next;
    });
  };

  const activate = (item: FlatItem) => {
    if (item.node.storyId) selectStory(item.node.storyId);
    else toggle(item.node.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, position: number) => {
    const item = flat[position]!;
    switch (event.key) {
      case 'ArrowDown':
        focusItem(flat[position + 1]?.node.id);
        break;
      case 'ArrowUp':
        focusItem(flat[position - 1]?.node.id);
        break;
      case 'Home':
        focusItem(flat[0]?.node.id);
        break;
      case 'End':
        focusItem(flat[flat.length - 1]?.node.id);
        break;
      case 'ArrowRight':
        if (item.node.children.length && !item.expanded) toggle(item.node.id, true);
        else if (item.node.children.length) focusItem(flat[position + 1]?.node.id);
        break;
      case 'ArrowLeft':
        if (item.node.children.length && item.expanded) toggle(item.node.id, false);
        else focusItem(item.parent);
        break;
      case 'Enter':
      case ' ':
        activate(item);
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now();
          const state = typeahead.current;
          state.text = now - state.at < 600 ? state.text + event.key.toLowerCase() : event.key.toLowerCase();
          state.at = now;
          const match =
            flat.slice(position + 1).find((i) => i.node.label.toLowerCase().startsWith(state.text)) ??
            flat.find((i) => i.node.label.toLowerCase().startsWith(state.text));
          if (match) focusItem(match.node.id);
          break;
        }
        return;
    }
    event.preventDefault();
  };

  const storyCount = index?.files.reduce((sum, f) => sum + f.stories.length, 0) ?? 0;
  const statusText =
    nextStatus === 'ready'
      ? `Next ${config.project.next} · ${config.project.bundler}`
      : nextStatus === 'restarting'
        ? 'Restarting Next (bundler config changed)…'
        : nextStatus === 'error'
          ? `Next failed: ${nextError ?? 'unknown error'}`
          : config.static
            ? 'Static build'
            : 'Starting Next…';

  // Render the flat list as nested ARIA groups so screen readers announce levels and sets.
  const renderLevel = (nodes: TreeNode[], depth: number): ReactElement[] =>
    nodes.map((node) => {
      const position = flat.findIndex((i) => i.node.id === node.id);
      const item = flat[position];
      if (!item) return <li key={node.id} hidden />;
      const isStory = node.kind === 'story';
      return (
        <li key={node.id} role="none">
          <div
            ref={(el) => {
              if (el) itemRefs.current.set(node.id, el);
              else itemRefs.current.delete(node.id);
            }}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isStory ? node.storyId === storyId : undefined}
            data-story-id={isStory ? node.storyId : undefined}
            aria-expanded={node.children.length ? item.expanded : undefined}
            tabIndex={node.id === activeId ? 0 : -1}
            className="treeitem"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              setFocused(node.id);
              activate(item);
            }}
            onKeyDown={(event) => onKeyDown(event, position)}
            title={node.path ?? node.storyId}
          >
            {node.children.length ? (
              <span className="chevron">
                <Icon name="chevron" />
              </span>
            ) : (
              <span className="chevron" />
            )}
            <span className={`label${node.kind === 'group' ? ' muted' : ''}`}>
              <Highlight text={node.label} query={query.trim()} />
            </span>
            {node.error ? (
              <span className="tone" data-tone="error" title={node.error}>
                !
              </span>
            ) : null}
            {node.kind === 'component' ? <span className="count">{node.children.length}</span> : null}
          </div>
          {node.children.length && item.expanded ? <ul role="group">{renderLevel(node.children, depth + 1)}</ul> : null}
        </li>
      );
    });

  return (
    <nav className="sidebar" aria-label="Stories">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        RSC Stories
        <small>{config.project.name}</small>
      </div>
      <div className="search" role="search">
        <label htmlFor="story-search" className="sr-only">
          Search stories
        </label>
        <input
          id="story-search"
          ref={searchRef}
          type="search"
          placeholder="Search stories  (Ctrl K)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(flat[0]?.node.id);
            } else if (event.key === 'Escape') {
              setQuery('');
            }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {indexError ? (
        <p className="panel-body" role="alert">
          Could not load stories: {indexError}
        </p>
      ) : null}
      {index && flat.length === 0 ? (
        <p className="panel-body muted">{query ? `No stories match “${query}”.` : 'No stories found. Add a *.stories.tsx file.'}</p>
      ) : null}
      <ul role="tree" aria-label="Story tree" className="tree">
        {renderLevel(visibleTree, 0)}
      </ul>
      <div className="status" role="status" aria-live="polite">
        <span
          className="dot"
          data-state={nextStatus === 'ready' || config.static ? 'ok' : nextStatus === 'error' ? 'error' : 'busy'}
          aria-hidden="true"
        />
        <span>{statusText}</span>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {storyCount} stories
        </span>
      </div>
    </nav>
  );
}

/** Closes the narrow-screen sidebar overlay. */
export function closeSidebar(): void {
  store.set({ sidebarOpen: false });
}
