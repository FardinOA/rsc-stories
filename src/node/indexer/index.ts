import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { sanitize, titleFromPath, toFileKey } from '../../shared/ids';
import { parseStoryFile, type IndexedStory, type ParsedStoryFile } from './parse';

export type { IndexedStory, ParsedStoryFile } from './parse';

/** A story file in the index. */
export interface IndexedFile extends ParsedStoryFile {
  /** Absolute path. */
  file: string;
  /** Path relative to the project root, with forward slashes. */
  relativePath: string;
  /** Route-safe unique key used in canvas URLs and generated route folders. */
  fileKey: string;
  /** Parse error, if the file could not be analysed. */
  error?: string;
}

/** Every story file the workshop knows about. */
export interface StoryIndex {
  files: IndexedFile[];
  /** Union of module specifiers mocked anywhere; drives bundler aliases. */
  mockSpecifiers: string[];
  /** Storybook files that were skipped. */
  skipped: string[];
  /** Duplicate story ids and similar problems. */
  problems: string[];
}

const IGNORE = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.rsc-stories/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/__rsc_snapshots__/**',
];

/** Finds story files for the configured globs. */
export async function findStoryFiles(root: string, patterns: string[]): Promise<string[]> {
  const files = await glob(patterns, { cwd: root, ignore: IGNORE, absolute: true, dot: false });
  return files.map((file) => path.normalize(file)).sort();
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** Parses one story file; failures become an indexed file with `error` set. */
export async function indexFile(root: string, file: string): Promise<IndexedFile> {
  const relativePath = toPosix(path.relative(root, file));
  try {
    const source = await readFile(file, 'utf8');
    const parsed = parseStoryFile(source, file, relativePath);
    return { ...parsed, file, relativePath, fileKey: toFileKey(parsed.componentId) };
  } catch (error) {
    const message = (error as Error).message;
    const title = titleFromPath(relativePath);
    return {
      title,
      componentId: sanitize(title),
      stories: [],
      mockSpecifiers: [],
      tags: [],
      isStorybook: false,
      warnings: [],
      file,
      relativePath,
      fileKey: toFileKey(sanitize(title)),
      error: message,
    };
  }
}

/** Builds the index from parsed files: unique file keys, duplicate-id checks, mock union. */
export function buildIndex(parsed: IndexedFile[], extraSpecifiers: string[] = []): StoryIndex {
  const files: IndexedFile[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  const keys = new Set<string>();
  const storyIds = new Map<string, string>();
  const specifiers = new Set(extraSpecifiers);

  for (const file of parsed) {
    if (file.isStorybook) {
      skipped.push(file.relativePath);
      continue;
    }
    let fileKey = file.fileKey;
    for (let n = 2; keys.has(fileKey); n++) fileKey = `${file.fileKey}-${n}`;
    if (fileKey !== file.fileKey) {
      problems.push(
        `${file.relativePath}: component id "${file.componentId}" is already used by another file; set meta.id or meta.title to keep ids unique.`,
      );
    }
    keys.add(fileKey);
    for (const story of file.stories) {
      const existing = storyIds.get(story.id);
      if (existing) problems.push(`Duplicate story id "${story.id}" in ${existing} and ${file.relativePath}.`);
      storyIds.set(story.id, file.relativePath);
    }
    for (const specifier of file.mockSpecifiers) specifiers.add(specifier);
    files.push({ ...file, fileKey });
  }
  files.sort((a, b) => a.title.localeCompare(b.title));
  return { files, mockSpecifiers: [...specifiers].sort(), skipped, problems };
}

/** Scans and indexes a project. */
export async function createIndex(root: string, patterns: string[], extraSpecifiers: string[] = []): Promise<StoryIndex> {
  const found = await findStoryFiles(root, patterns);
  const parsed = await Promise.all(found.map((file) => indexFile(root, file)));
  return buildIndex(parsed, extraSpecifiers);
}

/** Finds a story by id. */
export function findStory(index: StoryIndex, storyId: string): { file: IndexedFile; story: IndexedStory } | undefined {
  for (const file of index.files) {
    const story = file.stories.find((s) => s.id === storyId);
    if (story) return { file, story };
  }
  return undefined;
}

/** JSON sent to the workshop UI for the sidebar. */
export function indexToJson(index: StoryIndex) {
  return {
    files: index.files.map((file) => ({
      fileKey: file.fileKey,
      title: file.title,
      componentId: file.componentId,
      path: file.relativePath,
      tags: file.tags,
      error: file.error ?? null,
      warnings: file.warnings,
      stories: file.stories,
    })),
    skipped: index.skipped,
    problems: index.problems,
  };
}

export type IndexJson = ReturnType<typeof indexToJson>;
