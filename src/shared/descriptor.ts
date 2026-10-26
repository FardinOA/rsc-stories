import type { JsonValue } from '../types';

/** A mock as listed in the Mocks panel. */
export interface MockCatalogItem {
  key: string;
  kind: 'module' | 'fetch' | 'next';
  label: string;
  detail?: JsonValue;
  variants: string[];
  variant?: string;
  latency: number;
  active: boolean;
}

/** One story in a file descriptor. */
export interface StoryDescriptor {
  id: string;
  exportName: string;
  name: string;
  /** Args as JSON; non-JSON values are tagged (`{ $fn }`, `{ $date }`, …). */
  args: Record<string, JsonValue>;
  argTypes: Record<string, JsonValue>;
  parameters: Record<string, JsonValue>;
  hasPlay: boolean;
  hasRender: boolean;
  tags: string[];
  decorators: number;
  mocks: MockCatalogItem[];
  next: Record<string, JsonValue>;
  component: string | null;
  componentKind: 'client' | 'server' | 'shared' | 'none';
  error?: string;
}

/** What `/rsc-stories/meta/<fileKey>` returns: the evaluated story file. */
export interface FileDescriptor {
  fileKey: string;
  componentId: string;
  title: string;
  path: string;
  component: string | null;
  componentKind: 'client' | 'server' | 'shared' | 'none';
  tags: string[];
  stories: StoryDescriptor[];
}
