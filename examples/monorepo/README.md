# Monorepo example

`apps/web` is the Next.js app; `packages/ui` holds shared components and their stories;
`packages/data` is a server-only data package the stories mock. Run the workshop from the app:

```sh
pnpm --filter example-monorepo-web stories
```

`apps/web/.rsc-stories/config.ts` points `stories` at `../../packages/ui/src`.
