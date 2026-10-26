// Next.js compatibility check (NFR-3.1): installs the packed package into a copy of
// examples/minimal on a given Next.js major, then runs the story tests against it — production
// build, a second run that must match the snapshots the first wrote, `next dev`, and the other
// bundler.
//
//   node scripts/compat.mjs --next 15 [--bundler webpack] [--keep]
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const nextMajor = option('--next', '16');
const bundler = option('--bundler');
const REACT = { 15: '~19.1.0', 16: '^19.2.0' };

function run(command, args, cwd, env = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}

const work = await mkdtemp(path.join(os.tmpdir(), `rsc-stories-next${nextMajor}-`));
try {
  run('pnpm', ['pack', '--pack-destination', work], root);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const tarball = path.join(work, `rsc-stories-${version}.tgz`);
  const project = path.join(work, 'app');
  const source = path.join(root, 'examples', 'minimal');
  for (const entry of ['src', '.rsc-stories', 'tsconfig.json', 'next.config.ts']) {
    await cp(path.join(source, entry), path.join(project, entry), {
      recursive: true,
      filter: (file) => !/(__rsc_snapshots__|\.cache|\.next)(\/|$)/.test(file),
    });
  }
  const playwright = JSON.parse(await readFile(path.join(root, 'node_modules', 'playwright', 'package.json'), 'utf8')).version;
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify(
      {
        name: `compat-next${nextMajor}`,
        private: true,
        dependencies: { next: `^${nextMajor}`, react: REACT[nextMajor] ?? 'latest', 'react-dom': REACT[nextMajor] ?? 'latest' },
        devDependencies: {
          'rsc-stories': `file:${tarball}`,
          playwright,
          typescript: '^5.9.0',
          '@types/node': '^22.0.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
        },
      },
      null,
      2,
    ),
  );
  run('npm', ['install', '--no-audit', '--no-fund'], project);
  const cli = ['node_modules/rsc-stories/dist/cli.js'];
  // Next 16 builds with Turbopack by default, Next 15 with webpack.
  const primary = bundler ?? (Number(nextMajor) >= 16 ? 'turbopack' : 'webpack');
  const other = primary === 'webpack' ? 'turbopack' : 'webpack';
  const flags = ['--bundler', primary];
  // The first run writes snapshots; the second must reproduce them exactly; `next dev` and the
  // other bundler share them.
  run('node', [...cli, 'test', '--browser', '-u', ...flags], project, { CI: '' });
  run('node', [...cli, 'test', '--browser', ...flags], project, { CI: '1' });
  run('node', [...cli, 'test', '--browser', '--dev', ...flags], project, { CI: '1' });
  run('node', [...cli, 'test', '--bundler', other], project, { CI: '1' });
  console.log(`\nNext.js ${nextMajor} (${primary}, cross-checked with ${other}): compatible`);
} finally {
  if (!argv.includes('--keep')) await rm(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
