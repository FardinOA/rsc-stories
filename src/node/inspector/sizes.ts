import { gzipSync } from 'node:zlib';
import type { ClientReference } from './flight';

/** Size of one JS chunk. */
export interface ChunkSize {
  url: string;
  bytes: number;
  gzip: number;
}

/** Fetches chunk bodies through the running server and caches their sizes by URL. */
export class ChunkSizer {
  private readonly cache = new Map<string, Promise<ChunkSize | undefined>>();

  constructor(private readonly origin: string) {}

  /** Normalizes the chunk entries of an `I` row into URLs. */
  static chunkUrls(reference: ClientReference): string[] {
    return reference.chunks
      .filter((chunk) => /\.js(\?|$)/.test(chunk))
      .map((chunk) => (chunk.startsWith('/') ? chunk : `/_next/${chunk.replace(/^\/?_next\//, '')}`));
  }

  size(url: string): Promise<ChunkSize | undefined> {
    let cached = this.cache.get(url);
    if (!cached) {
      cached = (async () => {
        try {
          const response = await fetch(new URL(url, this.origin));
          if (!response.ok) return undefined;
          const body = Buffer.from(await response.arrayBuffer());
          return { url, bytes: body.length, gzip: gzipSync(body).length };
        } catch {
          return undefined;
        }
      })();
      this.cache.set(url, cached);
    }
    return cached;
  }

  /** Development chunks change on every edit; forget them. */
  clear(): void {
    this.cache.clear();
  }
}

/** Client JS attributed to one Client Component (an estimate: chunks can be shared). */
export interface ClientComponentSize {
  name: string;
  module: string;
  file?: string;
  /** Chunks this component needs that the framework does not already load. */
  chunks: string[];
  bytes: number;
  gzip: number;
}

/**
 * Attributes chunk sizes to client components (FR-5.4). Chunks that framework references (Next's
 * own client components) also need are excluded: they load on every page regardless of the story.
 */
export async function attributeSizes(
  sizer: ChunkSizer,
  story: Array<ClientReference & { file?: string }>,
  framework: ClientReference[],
): Promise<{ components: ClientComponentSize[]; storyBytes: number; storyGzip: number; frameworkBytes: number }> {
  const frameworkChunks = new Set(framework.flatMap((ref) => ChunkSizer.chunkUrls(ref)));
  const components: ClientComponentSize[] = [];
  const storyChunks = new Set<string>();
  for (const ref of story) {
    const chunks = ChunkSizer.chunkUrls(ref).filter((url) => !frameworkChunks.has(url));
    const sizes = (await Promise.all(chunks.map((url) => sizer.size(url)))).filter((s): s is ChunkSize => !!s);
    for (const url of chunks) storyChunks.add(url);
    components.push({
      name: ref.exportName,
      module: ref.moduleId,
      ...(ref.file ? { file: ref.file } : {}),
      chunks,
      bytes: sizes.reduce((sum, s) => sum + s.bytes, 0),
      gzip: sizes.reduce((sum, s) => sum + s.gzip, 0),
    });
  }
  const storySizes = (await Promise.all([...storyChunks].map((url) => sizer.size(url)))).filter((s): s is ChunkSize => !!s);
  const frameworkSizes = (await Promise.all([...frameworkChunks].map((url) => sizer.size(url)))).filter((s): s is ChunkSize => !!s);
  return {
    components,
    storyBytes: storySizes.reduce((sum, s) => sum + s.bytes, 0),
    storyGzip: storySizes.reduce((sum, s) => sum + s.gzip, 0),
    frameworkBytes: frameworkSizes.reduce((sum, s) => sum + s.bytes, 0),
  };
}
