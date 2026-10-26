// Conformance suite (NFR-2.1, NFR-7.4): compares story output with `next build` output.
// Usage: node conformance/run.mjs   (after `pnpm build`)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree, diffLines, extractInlineFlight, FlightPayload, normalizeHtml, resolveStreamedHtml } from '../dist/node.js';
import { cases } from './cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');

function run(command, args, cwd, { until } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (chunk) => {
      output += chunk.toString();
      const match = until && until.exec(output);
      if (match) resolve({ child, match });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (!until && code === 0) resolve({ child, output });
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${output.slice(-3000)}`));
    });
  });
}

/** Client Component boundaries (name + props) in a Flight payload. */
function boundaries(payload, names) {
  const tree = buildTree(payload);
  const found = [];
  // Story payloads are walked from the story root; app payloads have no root marker, so read every
  // client reference element in the payload instead.
  const visit = (value) => {
    if (Array.isArray(value)) {
      if (value[0] === '$' && value.length >= 4) {
        const ref = payload.clientReference(value[1]);
        if (ref && names.includes(ref.exportName)) {
          const { children: _children, ...props } = payload.deref(value[3]) ?? {};
          found.push({ to: ref.exportName, props: normalizeProps(props) });
        }
      }
      value.forEach(visit);
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  if (tree.root) return tree.boundaries.filter((b) => names.includes(b.to)).map((b) => ({ to: b.to, props: normalizeProps(b.props) }));
  for (const row of payload.models.values()) visit(row.value);
  return found;
}

function normalizeProps(props) {
  return JSON.parse(JSON.stringify(props ?? {}).replace(/"\[Server Action [^\]]*\]"|"\$h[0-9a-f]+"|"\$F[0-9a-f]+"/g, '"<action>"'));
}

const byExample = new Map();
for (const testCase of cases) {
  if (!byExample.has(testCase.example)) byExample.set(testCase.example, []);
  byExample.get(testCase.example).push(testCase);
}

let failures = 0;
let port = 6400;
for (const [example, exampleCases] of byExample) {
  const cwd = path.join(root, example);
  const next = createRequire(path.join(cwd, 'package.json')).resolve('next/dist/bin/next');
  console.log(`\n${example}: next build…`);
  await run(process.execPath, [next, 'build'], cwd);
  const appPort = port++;
  const app = await run(process.execPath, [next, 'start', '-p', String(appPort)], cwd, { until: /Ready in|started server/i });
  const workshop = await run(process.execPath, [cli, 'serve', '--port', String(port++)], cwd, {
    until: /RSC Stories ready at \S*(http:\/\/\S+)/,
  });
  const origin = workshop.match[1].replace(/\u001b\[\d+m/g, '');
  try {
    for (const testCase of exampleCases) {
      const appHtml = await (await fetch(`http://localhost:${appPort}${testCase.route}`)).text();
      const appRsc = await (
        await fetch(`http://localhost:${appPort}${testCase.route}${testCase.route.includes('?') ? '&' : '?'}_rsc=`, {
          headers: { RSC: '1' },
        })
      ).text();
      const rendered = await (await fetch(`${origin}/__rsc_stories/api/render-story?id=${testCase.story}`)).json();
      const appComponent = resolveStreamedHtml(appHtml, testCase.selector)[0] ?? '';
      const storyComponent = resolveStreamedHtml(`<html><body>${rendered.storyHtml ?? ''}</body></html>`, testCase.selector)[0] ?? '';
      const htmlDiff = diffLines(normalizeHtml(appComponent), normalizeHtml(storyComponent)).filter((l) => l.op !== ' ');
      const appBoundaries = boundaries(new FlightPayload(appRsc), testCase.clientComponents);
      const storyBoundaries = boundaries(new FlightPayload(extractInlineFlight(rendered.html)), testCase.clientComponents);
      const rscMatches = JSON.stringify(appBoundaries) === JSON.stringify(storyBoundaries);
      const ok = appComponent !== '' && htmlDiff.length === 0 && rscMatches;
      if (!ok) failures++;
      console.log(`${ok ? '✓' : '✗'} ${testCase.story} ≡ ${testCase.route} ${testCase.selector}`);
      if (appComponent === '') console.log('    selector matched nothing in the app HTML');
      for (const line of htmlDiff.slice(0, 20)) console.log(`    ${line.op} ${line.text}`);
      if (!rscMatches)
        console.log(
          `    RSC boundaries differ:\n      app:   ${JSON.stringify(appBoundaries)}\n      story: ${JSON.stringify(storyBoundaries)}`,
        );
    }
  } finally {
    app.child.kill();
    workshop.child.kill();
  }
}
console.log(failures ? `\n${failures} conformance case(s) failed` : '\nall conformance cases passed');
process.exit(failures ? 1 : 0);
