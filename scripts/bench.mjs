// Performance benchmark (NFR-1.1–1.4): generates 200 stories into examples/minimal, then measures
// cold start, story switch, hot reload and `rsc-stories test`. Generated files are removed after.
//
//   node scripts/bench.mjs [--json out.json] [--skip-test] [--max-test-ms 60000]
//
// BENCH_PASSES (default 3) sets how many rounds of story switches are timed; BENCH_PAUSE_MS
// (default 500) the pause between switches.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const project = path.join(root, 'examples', 'minimal');
const benchDir = path.join(project, 'src', '__bench__');
const FILES = 40;
const PER_FILE = 5;
const PORT = 6310;
const PAUSE_MS = Number(process.env.BENCH_PAUSE_MS ?? 500);
const origin = `http://localhost:${PORT}`;
const argv = process.argv.slice(2);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const jsonOut = option('--json');
const maxTestMs = option('--max-test-ms') ? Number(option('--max-test-ms')) : undefined;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};
const round = (value) => Math.round(value);

async function generate() {
  await rm(benchDir, { recursive: true, force: true });
  await mkdir(benchDir, { recursive: true });
  for (let i = 0; i < FILES; i++) {
    await writeFile(
      path.join(benchDir, `Item${i}.tsx`),
      `import { follow } from '@/app/actions';
import { db } from '@/lib/db';
import { FollowButton } from '../components/FollowButton';

export async function Item${i}({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const user = await db.users.findById(userId);
  if (!user) return <p>Nobody here (#${i}).</p>;
  return (
    <section className="card" data-bench="${i}">
      <h3 data-version="0">{user.name} #${i}</h3>
      {compact ? null : <p>{user.bio}</p>}
      <FollowButton userId={user.id} followers={user.followers} follow={follow} />
    </section>
  );
}
`,
    );
    const stories = ['Default', 'Compact', 'Missing', 'Slow', 'LongBio'].slice(0, PER_FILE);
    await writeFile(
      path.join(benchDir, `Item${i}.stories.tsx`),
      `import type { Meta, StoryObj } from 'rsc-stories';
import { Item${i} } from './Item${i}';

const user = { id: 'u1', name: 'Bench User', handle: 'bench', bio: 'Generated for the benchmark.', followers: ${i} };

const meta = {
  title: 'Bench/Item${String(i).padStart(2, '0')}',
  component: Item${i},
  args: { userId: 'u1' },
  mocks: { modules: { '@/lib/db': { users: { findById: async (id: string) => (id === 'u1' ? user : null), follow: async () => 1 } } } },
} satisfies Meta<typeof Item${i}>;

export default meta;
type Story = StoryObj<typeof meta>;

${stories
  .map((name) => {
    if (name === 'Compact') return `export const Compact: Story = { args: { compact: true } };`;
    if (name === 'Missing') return `export const Missing: Story = { args: { userId: 'nobody' } };`;
    if (name === 'Slow') return `export const Slow: Story = { mocks: { latency: 20 } };`;
    if (name === 'LongBio')
      return `export const LongBio: Story = { mocks: { modules: { '@/lib/db': { users: { findById: async () => ({ ...user, bio: 'Long. '.repeat(200) }) } } } } };`;
    return `export const ${name}: Story = {};`;
  })
  .join('\n')}
`,
    );
  }
}

/** Starts `rsc-stories dev`; resolves once the given marker is printed. */
function startDev() {
  const child = spawn(process.execPath, [cli, 'dev', '--port', String(PORT)], {
    cwd: project,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const started = performance.now();
  const ready = new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk;
      if (/ready in \d+ ms/.test(output)) resolve(performance.now() - started);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`dev exited with ${code}\n${output}`)));
  });
  return { child, ready, started, output: () => output };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function measureColdStart() {
  await rm(path.join(project, '.rsc-stories', '.cache', 'workshop'), { recursive: true, force: true });
  const dev = startDev();
  const ready = await dev.ready;
  const index = await (await fetch(`${origin}/__rsc_stories/api/index`)).json();
  const stories = index.files.reduce((sum, file) => sum + file.stories.length, 0);
  const indexReady = performance.now() - dev.started;
  return { dev, ready, indexReady, stories };
}

/**
 * Records, inside the canvas, the moment `selector` first matches (epoch ms). Measuring in the page
 * avoids Playwright's polling intervals, which would round paints up to the next poll.
 */
async function watchCanvas(page, selector) {
  const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
  await frame.evaluate((sel) => {
    window.__benchSeen = new Promise((resolve) => {
      const check = () => {
        if (!document.querySelector(sel)) return false;
        resolve(performance.timeOrigin + performance.now());
        return true;
      };
      if (check()) return;
      const observer = new MutationObserver(() => {
        if (check()) observer.disconnect();
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  }, selector);
  return () => frame.evaluate(() => window.__benchSeen);
}

async function measureSwitch(page) {
  // NFR-1.2 is about stories that are already compiled: two stories from each of five files,
  // compiled by a warm-up pass, then switched between through the sidebar.
  const files = [0, 1, 2, 3, 4].map((i) => `Item${String(i).padStart(2, '0')}`);
  const ids = files.flatMap((file) => [`bench-${file.toLowerCase()}--default`, `bench-${file.toLowerCase()}--compact`]);
  const tree = page.getByRole('tree', { name: 'Story tree' });
  for (const label of ['Bench', ...files]) {
    const item = tree.getByRole('treeitem', { name: new RegExp(`^${label}\\b`) }).first();
    if ((await item.getAttribute('aria-expanded')) === 'false') await item.click();
  }
  const show = async (id) => {
    const seen = await watchCanvas(page, `[data-rsc-stories-root][data-story-id="${id}"] :is(h3, p)`);
    const started = await page.evaluate((storyId) => {
      const at = performance.timeOrigin + performance.now();
      document.querySelector(`[role="treeitem"][data-story-id="${storyId}"]`).click();
      return at;
    }, id);
    return (await seen()) - started;
  };
  for (const id of ids) await show(id);
  const samples = [];
  const slowest = [];
  for (let pass = 0; pass < Number(process.env.BENCH_PASSES ?? 3); pass++) {
    for (const id of ids) {
      // A person reads a story before opening the next; the workshop finishes its own post-render
      // work (reports, hydration checks) in that time.
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      const ms = await show(id);
      samples.push(ms);
      slowest.push({ id, pass, ms: round(ms) });
    }
  }
  slowest.sort((a, b) => b.ms - a.ms);
  return { samples: samples.length, median: round(median(samples)), p95: round(p95(samples)), slowest: slowest.slice(0, 8) };
}

async function measureHotReload(page) {
  const file = path.join(benchDir, 'Item0.tsx');
  const frame = page.frameLocator('iframe');
  await page.goto(`${origin}/?story=bench-item00--default`);
  await frame.locator('[data-bench="0"] h3').waitFor({ timeout: 120_000 });
  const original = await readFile(file, 'utf8');
  const samples = [];
  try {
    for (let n = 1; n <= 10; n++) {
      const seen = await watchCanvas(page, `[data-bench="0"] h3[data-version="${n}"]`);
      const started = performance.timeOrigin + performance.now();
      await writeFile(file, original.replace('data-version="0"', `data-version="${n}"`));
      samples.push((await seen()) - started);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } finally {
    await writeFile(file, original);
  }
  return { samples: samples.length, median: round(median(samples)), p95: round(p95(samples)) };
}

function runTest() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [cli, 'test', '-u', '--filter', 'bench-'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => {
      const total = performance.now() - started;
      const summary = output.trim().split('\n').at(-1);
      if (code === 0) resolve({ ms: round(total), summary });
      else reject(new Error(`rsc-stories test failed (${code})\n${output.slice(-3000)}`));
    });
  });
}

if (!existsSync(cli)) throw new Error('Build first: pnpm build');
const results = {
  machine: `${os.cpus()[0]?.model ?? 'unknown CPU'} · ${os.cpus().length} cores · ${Math.round(os.totalmem() / 2 ** 30)} GB · Node ${process.versions.node}`,
};
await generate();
let dev;
let browser;
try {
  const cold = await measureColdStart();
  dev = cold.dev;
  results.stories = cold.stories;
  results.coldStartMs = round(cold.ready);
  results.indexReadyMs = round(cold.indexReady);
  console.log(`cold start: ready ${results.coldStartMs} ms, index (${cold.stories} stories) ${results.indexReadyMs} ms`);

  browser = await chromium.launch();
  const page = await browser.newPage();
  let started = performance.now();
  await page.goto(`${origin}/?story=bench-item00--default`);
  await page.frameLocator('iframe').locator('[data-bench="0"]').waitFor({ timeout: 180_000 });
  results.firstStoryMs = round(performance.now() - started);
  console.log(`first story (includes first compile): ${results.firstStoryMs} ms`);

  results.storySwitch = await measureSwitch(page);
  console.log(`story switch (compiled): median ${results.storySwitch.median} ms, p95 ${results.storySwitch.p95} ms`);
  results.hotReload = await measureHotReload(page);
  console.log(`hot reload: median ${results.hotReload.median} ms, p95 ${results.hotReload.p95} ms`);
} finally {
  await browser?.close();
  if (dev) await stop(dev.child);
}
try {
  if (!argv.includes('--skip-test')) {
    results.test = await runTest();
    console.log(`rsc-stories test (generated stories, production build included): ${results.test.ms} ms — ${results.test.summary}`);
  }
} finally {
  await rm(benchDir, { recursive: true, force: true });
}
if (jsonOut) await writeFile(path.resolve(jsonOut), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (maxTestMs !== undefined && results.test && results.test.ms > maxTestMs) {
  console.error(`rsc-stories test took ${results.test.ms} ms, over the ${maxTestMs} ms budget (NFR-1.4).`);
  process.exit(1);
}
