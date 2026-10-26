import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { findProjectRoot } from '../project';

export interface InitOptions {
  cwd: string;
  /** Overwrite nothing; only report what would be written. */
  dryRun?: boolean;
}

const CONFIG = (storiesGlob: string) => `import { defineConfig } from 'rsc-stories';

export default defineConfig({
  stories: ['${storiesGlob}'],
  // Turn unmocked network requests into errors once your stories mock their data.
  mocks: { strictNetwork: false },
  budgets: { rscPayloadKb: 30, clientJsKbPerStory: 80 },
  // Environment variables stories may read; everything else is removed (secrets never leak into a build).
  env: { allow: ['NEXT_PUBLIC_*'] },
});
`;

const PREVIEW = (
  cssImport: string | undefined,
) => `// Applied to every story, like your app's root layout.${cssImport ? `\nimport '${cssImport}';` : ''}
import type { Decorator } from 'rsc-stories';

export const decorators: Decorator[] = [];
`;

const COMPONENT = `/** An async Server Component: it awaits data before it renders. */
export async function Welcome({ name }: { name: string }) {
  const response = await fetch('https://api.example.com/greeting?name=' + encodeURIComponent(name));
  const { message } = (await response.json()) as { message: string };
  return (
    <section style={{ fontFamily: 'system-ui, sans-serif' }}>
      <h1>{message}</h1>
      <p>This story renders on the server through your own Next.js. Open the Inspector panel.</p>
    </section>
  );
}
`;

const STORY = `import type { Meta, StoryObj } from 'rsc-stories';
import { Welcome } from './Welcome';

const meta = {
  title: 'Getting started/Welcome',
  component: Welcome,
  args: { name: 'RSC Stories' },
  mocks: {
    fetch: [
      {
        name: 'greeting',
        match: 'GET https://api.example.com/greeting',
        response: (_request, { url }) => ({ message: \`Hello, \${url.searchParams.get('name')}!\` }),
      },
    ],
  },
} satisfies Meta<typeof Welcome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The fetch never answers, so the Suspense fallback stays on screen. */
export const Loading: Story = {
  mocks: { latency: { fetch: Infinity } },
};
`;

async function writeNew(file: string, content: string, dryRun: boolean, written: string[]): Promise<void> {
  if (existsSync(file)) {
    console.log(`  ${pc.dim('exists')}  ${file}`);
    return;
  }
  if (!dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  written.push(file);
  console.log(`  ${pc.green('create')}  ${file}`);
}

/** `rsc-stories init` (FR-6.1). Never overwrites existing files. */
export async function init(options: InitOptions): Promise<number> {
  const root = findProjectRoot(options.cwd);
  const dryRun = !!options.dryRun;
  const rel = (file: string) => path.relative(root, file) || '.';
  const written: string[] = [];
  const hasSrc = existsSync(path.join(root, 'src'));
  const glob = hasSrc ? 'src/**/*.stories.{tsx,ts,jsx,js}' : '**/*.stories.{tsx,ts,jsx,js}';
  const css = ['src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css'].find((file) =>
    existsSync(path.join(root, file)),
  );
  console.log(`\n${pc.bold('rsc-stories init')} ${pc.dim(root)}\n`);
  await writeNew(path.join(root, '.rsc-stories', 'config.ts'), CONFIG(glob), dryRun, written);
  await writeNew(path.join(root, '.rsc-stories', 'preview.tsx'), PREVIEW(css ? `../${css}` : undefined), dryRun, written);
  const componentsDir = ['src/components', 'components', 'src', '.'].map((dir) => path.join(root, dir)).find((dir) => existsSync(dir))!;
  const exampleDir = path.join(componentsDir, 'rsc-stories-example');
  await writeNew(path.join(exampleDir, 'Welcome.tsx'), COMPONENT, dryRun, written);
  await writeNew(path.join(exampleDir, 'Welcome.stories.tsx'), STORY, dryRun, written);

  // package.json scripts
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as { scripts?: Record<string, string> };
  pkg.scripts ??= {};
  const scripts = { stories: 'rsc-stories dev', 'stories:build': 'rsc-stories build', 'stories:test': 'rsc-stories test' };
  let changedScripts = false;
  for (const [name, command] of Object.entries(scripts)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = command;
      changedScripts = true;
      console.log(`  ${pc.green('script')}  ${name}: ${command}`);
    }
  }
  if (changedScripts && !dryRun) await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

  // .gitignore
  const ignoreFile = path.join(root, '.gitignore');
  const ignore = existsSync(ignoreFile) ? await readFile(ignoreFile, 'utf8') : '';
  const additions = ['.rsc-stories/.cache', 'rsc-stories-static'].filter((line) => !ignore.split('\n').includes(line));
  if (additions.length) {
    if (!dryRun) await writeFile(ignoreFile, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}${additions.join('\n')}\n`);
    console.log(`  ${pc.green('ignore')}  ${additions.join(', ')} ${pc.dim('(.gitignore)')}`);
  }

  console.log(`
${pc.bold('Next steps')}
  1. Install:  ${pc.cyan('npm install --save-dev rsc-stories')}   ${pc.dim('(or pnpm add -D / yarn add -D)')}
  2. Start:    ${pc.cyan('npm run stories')}  →  http://localhost:6006
  3. Open "Getting started/Welcome", then the Inspector panel.
  ${pc.dim(`Example story: ${rel(path.join(exampleDir, 'Welcome.stories.tsx'))}`)}
`);
  return 0;
}
