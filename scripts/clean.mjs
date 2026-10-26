// Empties dist/ before a build (tsup's own `clean` races between parallel configurations).
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
