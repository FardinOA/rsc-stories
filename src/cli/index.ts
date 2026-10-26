import { parseArgs } from 'node:util';
import pc from 'picocolors';

const HELP = `
${pc.bold('rsc-stories')} — a component workshop for React Server Components

Usage
  rsc-stories <command> [options]

Commands
  init       Scaffold .rsc-stories/ and an example story
  dev        Start the workshop with hot reload            (default port 6006)
  serve      Build and serve the workshop without watching (--dev: next dev)
  build      Emit a static workshop                         (--out-dir)
  test       Render every story and check snapshots/budgets (--update, --browser)
  doctor     Check versions and configuration
  migrate    Convert Storybook CSF stories                  (rsc-stories migrate <glob>)

Options
  --port <n>      Port for dev/test servers
  --host <h>      Host to bind (default localhost)
  --cwd <dir>     Project directory (default: current directory)
  --open          Open the workshop in a browser (dev)
  --out-dir <d>   Output directory (build)
  --update, -u    Rewrite snapshots (test)
  --browser       Also hydrate stories and run play functions in Chromium (test)
  --filter <s>    Only stories whose id contains <s> (test, build)
  --json <file>   Write the test results as JSON
  --dev           Run test/build against next dev instead of a production build
  --bundler <b>   turbopack or webpack (default: the installed Next's default)
  --in-place      Rewrite Storybook files instead of writing *.rsc.stories.* copies (migrate)
  --help, -h      Show this help
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      cwd: { type: 'string' },
      open: { type: 'boolean' },
      'out-dir': { type: 'string' },
      update: { type: 'boolean', short: 'u' },
      browser: { type: 'boolean' },
      filter: { type: 'string' },
      json: { type: 'string' },
      dev: { type: 'boolean' },
      'in-place': { type: 'boolean' },
      bundler: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command = 'help', ...rest] = positionals;
  const cwd = values.cwd ?? process.cwd();
  if (values.bundler) {
    if (values.bundler !== 'turbopack' && values.bundler !== 'webpack') {
      console.error(`--bundler must be "turbopack" or "webpack", not "${values.bundler}".`);
      return 1;
    }
    process.env.RSC_STORIES_BUNDLER = values.bundler;
  }
  const port = values.port !== undefined ? Number.parseInt(values.port, 10) : undefined;
  if (values.help || command === 'help') {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'dev': {
      const { dev } = await import('../node/commands/dev');
      await dev({
        cwd,
        ...(port !== undefined ? { port } : {}),
        ...(values.host ? { host: values.host } : {}),
        ...(values.open ? { open: true } : {}),
      });
      return new Promise<number>(() => {});
    }
    case 'serve': {
      const { serve } = await import('../node/commands/serve');
      await serve({ cwd, ...(port !== undefined ? { port } : {}), ...(values.dev ? { dev: true } : {}) });
      return new Promise<number>(() => {});
    }
    case 'build': {
      const { buildStatic } = await import('../node/commands/build');
      return buildStatic({
        cwd,
        ...(values['out-dir'] ? { outDir: values['out-dir'] } : {}),
        ...(values.filter ? { filter: values.filter } : {}),
        ...(values.dev ? { dev: true } : {}),
      });
    }
    case 'test': {
      const { test } = await import('../node/commands/test');
      return test({
        cwd,
        update: !!values.update,
        browser: !!values.browser,
        dev: !!values.dev,
        ...(values.filter ? { filter: values.filter } : {}),
        ...(values.json ? { json: values.json } : {}),
        ...(port ? { port } : {}),
      });
    }
    case 'init': {
      const { init } = await import('../node/commands/init');
      return init({ cwd });
    }
    case 'doctor': {
      const { doctor } = await import('../node/commands/doctor');
      return doctor({ cwd });
    }
    case 'migrate': {
      const { migrate } = await import('../node/commands/migrate');
      return migrate({ cwd, patterns: rest.length ? rest : ['**/*.stories.{tsx,ts,jsx,js}'], inPlace: !!values['in-place'] });
    }
    default:
      console.error(`Unknown command "${command}".\n${HELP}`);
      return 1;
  }
}

/**
 * One-shot commands exit when done: Next's dev server (and some plugins) leave watchers and
 * workers behind that would otherwise keep the process alive. Output is flushed first.
 */
function exit(code: number): void {
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}

main().then(
  (code) => exit(code ?? 0),
  (error: unknown) => {
    const err = error as Error;
    console.error(`\n${pc.red('✖')} ${err.name === 'ProjectError' ? err.message : (err.stack ?? String(error))}\n`);
    exit(1);
  },
);
