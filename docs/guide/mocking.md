---
title: Mocking
order: 3
---

# Mocking

Stories render on the server, so their data comes from server-side sources: database clients,
`fetch`, cookies, headers. RSC Stories mocks them per story, per render — and keeps mocks isolated
between concurrent renders.

```tsx
mocks: {
  modules: { '@/lib/db': { orders: { findById: async () => order } } },
  fetch: [{ match: 'GET https://api.example.com/rates', response: { EUR: 0.92 } }],
  next: { cookies: { locale: 'en' }, headers: { 'x-region': 'eu' }, searchParams: { q: 'shoes' } },
  latency: { '@/lib/db': 800 },
  strictNetwork: true,
}
```

Mocks layer: `config.ts` → `preview.tsx` → `meta` → story → runtime overrides from the Mocks
panel (later wins). Use a **function** when mocks hold state, so every render starts fresh:

```tsx
mocks: () => {
  let followers = 10;
  return { modules: { '@/lib/db': { users: { follow: async () => ++followers } } } };
},
```

## Modules

Replace (parts of) any module your components import — a database client, an SDK wrapper, a
`server-only` helper. Keys are module specifiers as you import them; values are partial modules:

```tsx
modules: {
  '@/lib/db': {
    db: { orders: { findById: async (id: string) => ({ id, status: 'paid', lines: [] }) } },
  },
  '@/lib/flags': { isEnabled: () => true },
},
```

- Only what you specify is replaced; other exports and properties fall through to the real module.
- If a module has a single object export (`export const db = …`), you can omit its name:
  `{ orders: { findById } }` patches `db.orders.findById`.
- Every call is recorded (arguments, result, duration) in the Calls panel.
- Primitive exports (`export const VERSION = '1'`) cannot change per story; mock the function that
  reads them.
- `'use server'` modules are not mocked: Server Actions already run with your story's mocks, so mock
  what they call.

Type them against the real module with `mockModule`:

```tsx
import { mockModule } from 'rsc-stories';
'@/lib/db': mockModule<typeof import('@/lib/db')>({ db: { orders: { findById: async () => null } } }),
```

### Variants

Variants are alternative implementations you can switch to from the Mocks panel without editing
code:

```tsx
import { mockVariants } from 'rsc-stories';

'@/lib/db': mockVariants(
  { products: { list: async () => products } },
  { empty: { products: { list: async () => [] } }, failing: { products: { list: async () => { throw new Error('timeout'); } } } },
),
```

### How module mocks are wired

Module specifiers used in `mocks.modules` anywhere are collected when the workshop starts and
aliased to small generated shims. With **webpack** the shim replaces the resolved file, so any
import spelling is covered. With **Turbopack**, aliases match the specifier: import mocked modules
with the same specifier the story uses (prefer path aliases such as `@/lib/db` over relative
imports). `rsc-stories doctor` lists every mocked module and where it resolves. Adding a _new_
specifier restarts Next once.

## fetch

```tsx
fetch: [
  { name: 'rates', match: 'GET https://api.frankfurter.app/latest', response: { rates: { EUR: 0.92 } } },
  { match: '/api/users/:id', response: (request, { params }) => ({ id: params.id }) },
  { match: { url: /\/search/, method: 'POST', body: (b) => (b as { q: string }).q === 'shoes' }, response: [] },
  { match: 'https://api.example.com/flaky', status: 503, response: { error: 'down' } },
  { match: 'https://api.example.com/offline', error: 'ECONNREFUSED' },
],
```

- **Matchers**: `"[METHOD ]url"` with `*` wildcards and `:param` segments (a path starting with `/`
  matches any origin; a pattern without `?` ignores the query), a `RegExp`, an object
  (`url`, `method`, `query`, `headers`, `body` predicate) or a function of the `Request`.
- **Responses**: plain values are JSON, strings are text, a `Response` is cloned, a function gets
  the request and `{ url, method, params, body }`.
- `delay` adds latency; `error` rejects like a network failure; `variants` work as for modules.
- An object form keys mocks by name: `fetch: { rates: { match, response } }`; `false` removes an
  inherited mock.

### Unmocked requests

A request no mock answers is still made, and shows up as a warning in the Mocks and Console panels.
Set `strictNetwork: true` (in a story or the config) to make it an error instead — recommended once
your stories are mocked, so a story can never silently hit the internet. Requests made with
`node:http`/`https` (axios, many SDKs) are reported and blocked the same way; to _answer_ them, mock
the module that wraps the client. The Mocks panel shows a ready-to-paste `mocks.fetch` entry for
every unmocked `fetch`.

Next.js's own downloads are not story requests: `next/font/google` fetching from
`fonts.googleapis.com` and `fonts.gstatic.com` while compiling is always let through.

## Next.js APIs

```tsx
next: {
  cookies: { session: 'u1', locale: 'en-GB' },   // cookies()
  headers: { 'x-region': 'eu' },                   // headers(), merged over the request's own
  draftMode: true,                                 // draftMode().isEnabled
  searchParams: { category: 'kitchen' },           // useSearchParams()
  params: { slug: 'stoneware-mug' },               // useParams()
  pathname: '/products',                           // usePathname()
  pageProps: true,                                 // also pass params/searchParams as promise props
}
```

- `cookies().set()` / `.delete()` work in Server Actions and are recorded; in render they throw,
  as in Next.
- `useRouter()` returns a recording router: `push`, `replace`, `back`, `forward` and `prefetch`
  are logged instead of navigating; `refresh()` re-runs the story's server render. Clicks on links
  inside the story are recorded too.
- `redirect()`, `permanentRedirect()`, `notFound()`, `forbidden()` and `unauthorized()` are
  intercepted: the canvas shows what would have happened instead of navigating away.
- `revalidatePath` / `revalidateTag` / `updateTag` / `refresh` are recorded (and still run).
- `unstable_cache` is bypassed by default so stories never share cached data; set
  `parameters.cache = 'warm'` to use Next's cache.

`next/image`, `next/link` and `next/font` need nothing: they run in your real Next.js.

## Latency

```tsx
latency: 800                                  // every mock
latency: { '@/lib/db': 3000, fetch: 300 }     // per module, all fetch mocks
latency: { 'fetch:rates': Infinity }          // never resolves: a permanent loading state
```

Latency applies to module mocks, fetch mocks, and also to _unmocked_ calls of a listed module — a
quick way to see a real implementation's Suspense fallbacks.

## Fixtures

```tsx
import { fixture, repeat } from 'rsc-stories';
import orderJson from './fixtures/order.json';

const order = fixture(orderJson);
order.value; // a fresh deep copy
order.with({ status: 'refunded' });
order.empty(); // arrays emptied
order.large(500); // arrays grown to 500 items, ids suffixed
order.loading(); // a promise that never settles
order.error('timeout'); // a rejected promise
order.delayed(1000);
repeat(50, (i) => ({ id: `p${i}` }));
```

## Environment variables

While stories render, only allowlisted variables exist (`config.env.allow`, default
`['NEXT_PUBLIC_*']`); your `.env` files are loaded and filtered the same way. Reading a removed
variable is reported as a warning. Production builds of the workshop never see the rest, so they
cannot inline secrets.
