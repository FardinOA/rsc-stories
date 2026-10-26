import type { ReactNode } from 'react';

/** Any JSON value. Used where data must survive the server → client boundary unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A component of any props: function (sync or async Server Component) or class. */
export type AnyComponent = ((props: never) => ReactNode | Promise<ReactNode>) | (abstract new (props: never) => unknown);

/** Props of a component, including async Server Components. */
export type PropsOf<T> = T extends (props: infer P) => unknown
  ? P
  : T extends abstract new (props: infer P) => unknown
    ? P
    : Record<string, unknown>;

/** Story arguments: the props a story passes to its component. */
export type Args = Record<string, unknown>;

/** Built-in control kinds rendered by the Controls panel. */
export type ControlType =
  'text' | 'textarea' | 'number' | 'range' | 'boolean' | 'select' | 'radio' | 'multi-select' | 'color' | 'date' | 'object';

/** Detailed control configuration for an arg. */
export interface ControlConfig {
  type: ControlType;
  /** Minimum for `number` and `range`. */
  min?: number;
  /** Maximum for `number` and `range`. */
  max?: number;
  /** Step for `number` and `range`. */
  step?: number;
  /** Display labels for `select`/`radio` options, keyed by option value. */
  labels?: Record<string, string>;
  /** Swatches offered by the `color` control. */
  presetColors?: string[];
}

/** Describes how one arg is documented and edited. */
export interface ArgType<TValue = unknown> {
  /** Display name (defaults to the arg key). */
  name?: string;
  /** Shown under the control. */
  description?: string;
  /** Control to render, or `false` to hide the control. Inferred from the prop type when omitted. */
  control?: ControlType | ControlConfig | false;
  /** Allowed values for `select`, `radio` and `multi-select`. */
  options?: readonly TValue[];
  /** Mark a function arg as an action: calls are logged in the Actions panel. */
  action?: string | boolean;
  /** Grouping and display hints for the Controls table. */
  table?: {
    category?: string;
    type?: { summary: string };
    defaultValue?: { summary: string };
    disable?: boolean;
  };
  /** The prop's type, as inferred or declared. */
  type?: { name: string; required?: boolean };
  /** Show the control only when another arg matches. */
  if?: { arg: string; truthy?: boolean; eq?: unknown; neq?: unknown };
}

/** Arg types keyed by arg name. */
export type ArgTypes<TArgs = Args> = { [K in keyof TArgs]?: ArgType<TArgs[K]> } & Record<string, ArgType | undefined>;

/** Canvas layout for a story. */
export type StoryLayout = 'padded' | 'fullscreen' | 'centered';

/** A viewport preset. */
export interface Viewport {
  name: string;
  width: number;
  height: number;
  /** Renders the frame with device chrome hints in the toolbar. */
  type?: 'mobile' | 'tablet' | 'desktop';
}

/** Budgets checked by the inspector and `rsc-stories test`. All sizes are in kilobytes. */
export interface Budgets {
  /** Maximum RSC payload attributable to the story (debug rows excluded). */
  rscPayloadKb?: number;
  /** Maximum client JavaScript attributable to the story's Client Components. */
  clientJsKbPerStory?: number;
  /** Maximum server render time in milliseconds (excluding simulated latency). */
  serverRenderMs?: number;
}

/** Story parameters: static, mostly presentational configuration. */
export interface Parameters {
  /** How the story is placed in the canvas. Defaults to `padded`. */
  layout?: StoryLayout;
  /** Canvas backgrounds. */
  backgrounds?: {
    default?: string;
    values?: Array<{ name: string; value: string }>;
    disable?: boolean;
  };
  /** Viewport presets and the default one. */
  viewport?: {
    defaultViewport?: string;
    viewports?: Record<string, Viewport>;
  };
  /**
   * Wrap the story in a `<Suspense>` boundary so an async root component streams instead of
   * blocking the shell. Defaults to `true`.
   */
  suspense?: boolean;
  /** `cold` (default) bypasses `unstable_cache`; `warm` uses Next's cache as in the app. */
  cache?: 'cold' | 'warm';
  /** Per-story budget overrides. */
  budgets?: Budgets;
  /** Accessibility panel options. */
  a11y?: { disable?: boolean; rules?: Record<string, { enabled: boolean }> };
  /** Free-form documentation shown above the canvas. */
  docs?: { description?: string };
  /** Addon parameters. */
  [key: string]: unknown;
}

/** Workshop-wide values (theme, locale, …) chosen in the toolbar and passed to decorators. */
export type Globals = Record<string, JsonValue>;

/** Context passed to `render`, decorators and `play`. */
export interface StoryContext<TArgs = Args> {
  /** Stable story id, e.g. `commerce-ordersummary--default`. */
  id: string;
  /** Display name of the story. */
  name: string;
  /** `meta.title` (or the title derived from the file path). */
  title: string;
  /** Export name in the story file. */
  exportName: string;
  args: TArgs;
  argTypes: ArgTypes<TArgs>;
  parameters: Parameters;
  globals: Globals;
  /** Where the story is being rendered. */
  mode: 'dev' | 'build' | 'test';
}

/** Serializable story context handed to client decorators. */
export interface ClientStoryContext {
  id: string;
  name: string;
  title: string;
  exportName: string;
  globals: Globals;
  parameters: Record<string, JsonValue>;
}

/** Renders the story (with args already applied) inside a decorator. */
export type StoryComponent = () => ReactNode | Promise<ReactNode>;

/**
 * A decorator wraps the story. Functions run on the server and receive the story as a component.
 * A Client Component (a `'use client'` export) is rendered as a wrapper and receives
 * `{ children, context }`, where `context` is a {@link ClientStoryContext}.
 */
export type Decorator<TArgs = Args> = (Story: StoryComponent, context: StoryContext<TArgs>) => ReactNode | Promise<ReactNode>;

/** Custom composition for a story; runs on the server. */
export type StoryRender<TArgs = Args> = (args: TArgs, context: StoryContext<TArgs>) => ReactNode | Promise<ReactNode>;

/** Helpers available to a `play` function. */
export interface PlayContext<TArgs = Args> {
  /** The element the story rendered into. */
  canvasElement: HTMLElement;
  /** Testing Library queries bound to the canvas. */
  canvas: CanvasQueries;
  /** `@testing-library/user-event`, already set up for the canvas document. */
  userEvent: UserEventApi;
  /** Group assertions into a named step in the Interactions panel. */
  step: (label: string, run: () => Promise<void> | void) => Promise<void>;
  args: TArgs;
  /** Story id and parameters. */
  id: string;
  parameters: Parameters;
}

/**
 * Testing Library queries bound to the canvas. Typed structurally so the core package does not
 * depend on `@testing-library/dom`; the runtime provides the real implementation.
 */
export interface CanvasQueries {
  getByRole(role: string, options?: { name?: string | RegExp; level?: number }): HTMLElement;
  findByRole(role: string, options?: { name?: string | RegExp; level?: number }): Promise<HTMLElement>;
  queryByRole(role: string, options?: { name?: string | RegExp; level?: number }): HTMLElement | null;
  getAllByRole(role: string, options?: { name?: string | RegExp }): HTMLElement[];
  getByText(text: string | RegExp): HTMLElement;
  findByText(text: string | RegExp, options?: unknown, waitFor?: { timeout?: number }): Promise<HTMLElement>;
  queryByText(text: string | RegExp): HTMLElement | null;
  getByLabelText(text: string | RegExp): HTMLElement;
  findByLabelText(text: string | RegExp): Promise<HTMLElement>;
  getByTestId(id: string): HTMLElement;
  findByTestId(id: string): Promise<HTMLElement>;
  getByPlaceholderText(text: string | RegExp): HTMLElement;
}

/** The subset of `@testing-library/user-event` most stories use. */
export interface UserEventApi {
  click(element: Element): Promise<void>;
  dblClick(element: Element): Promise<void>;
  hover(element: Element): Promise<void>;
  type(element: Element, text: string, options?: { delay?: number }): Promise<void>;
  clear(element: Element): Promise<void>;
  keyboard(text: string): Promise<void>;
  tab(options?: { shift?: boolean }): Promise<void>;
  selectOptions(element: Element, values: string | string[]): Promise<void>;
  upload(element: Element, file: File | File[]): Promise<void>;
}

/** Client-side interactions run after hydration (for tests and the Interactions panel). */
export type PlayFunction<TArgs = Args> = (context: PlayContext<TArgs>) => Promise<void> | void;

// ---------------------------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------------------------

/**
 * A stand-in implementation for (part of) a module. Keys are export names; nested objects and
 * functions replace the matching parts of the real export, everything else falls through to the
 * real module. For modules that export a single client object (e.g. `export const db = …`), the
 * export name may be omitted: `{ orders: { findById } }` patches `db.orders.findById`.
 */
export type ModuleMock = { readonly [key: string]: unknown };

/** Brand on module mocks created with {@link mockVariants}. */
export const VARIANTS: unique symbol = Symbol.for('rsc-stories.variants');

/** A module mock with named variants switchable from the Mocks panel. */
export interface ModuleMockWithVariants {
  readonly [VARIANTS]: {
    default: ModuleMock;
    variants: Record<string, ModuleMock>;
  };
}

/** Matches requests for a fetch mock. */
export type FetchMatcher =
  | string
  | RegExp
  | {
      /** Exact URL, pattern with `*`/`:param` segments, or path-only pattern starting with `/`. */
      url?: string | RegExp;
      /** HTTP method, case-insensitive. Defaults to any. */
      method?: string;
      /** Required query parameters. */
      query?: Record<string, string>;
      /** Required headers (case-insensitive names). */
      headers?: Record<string, string | RegExp>;
      /** Predicate over the parsed request body (JSON when possible, otherwise text). */
      body?: (body: unknown) => boolean;
    }
  | ((request: Request) => boolean);

/** Details about a matched request, passed to function responses. */
export interface FetchMockRequestInfo {
  url: URL;
  method: string;
  /** Path parameters captured by `:name` segments in the matcher. */
  params: Record<string, string>;
  /** Parsed body: JSON when possible, otherwise text, `undefined` when empty. */
  body: unknown;
}

/** What a fetch mock responds with. Plain values are sent as JSON (strings as text). */
export type FetchMockResponse =
  Response | JsonValue | ((request: Request, info: FetchMockRequestInfo) => Response | JsonValue | Promise<Response | JsonValue>);

/** Response behaviour of a fetch mock or one of its variants. */
export interface FetchMockBehavior {
  response?: FetchMockResponse;
  /** Status for non-`Response` responses. Defaults to 200. */
  status?: number;
  headers?: Record<string, string>;
  /** Extra latency in milliseconds before responding. */
  delay?: number;
  /** Reject like a network failure with this message. */
  error?: string;
}

/** Declares a mocked `fetch` endpoint. */
export interface FetchMock extends FetchMockBehavior {
  /** Stable name used by the Mocks panel and in overrides. Defaults to the matcher text. */
  name?: string;
  match: FetchMatcher;
  /** Alternative behaviours (`error`, `empty`, `slow`, …) switchable at runtime. */
  variants?: Record<string, FetchMockBehavior>;
}

/** Mocked values for Next.js request APIs and navigation hooks. */
export interface NextMocks {
  /** Cookies returned by `cookies()`. */
  cookies?: Record<string, string>;
  /** Headers returned by `headers()`; merged over the request's own headers. */
  headers?: Record<string, string>;
  /** `draftMode().isEnabled`. */
  draftMode?: boolean;
  /** `useSearchParams()` and the `searchParams` prop. */
  searchParams?: Record<string, string | string[]>;
  /** `useParams()` and the `params` prop. */
  params?: Record<string, string | string[]>;
  /** `usePathname()`. Defaults to `/`. */
  pathname?: string;
  /** Pass `params`/`searchParams` as promise props, like a page component receives them. */
  pageProps?: boolean;
}

/** Mocks for a story. Meta-level mocks are defaults; story-level mocks override them. */
export interface Mocks {
  /** Module specifier (as imported, e.g. `@/lib/db`) → partial implementation, or `false` to unmock. */
  modules?: Record<string, ModuleMock | ModuleMockWithVariants | false>;
  /** Mocked `fetch` endpoints, as a list or keyed by name. */
  fetch?: FetchMock[] | Record<string, FetchMock | false>;
  /** Next.js request APIs and navigation. */
  next?: NextMocks;
  /**
   * Simulated latency in milliseconds: one number for every mock, or per key — a module specifier,
   * `fetch:<name>`, or `fetch` for all fetch mocks.
   */
  latency?: number | Record<string, number>;
  /** Turn unmocked network requests into errors (overrides the config). */
  strictNetwork?: boolean;
}

/** Mocks may be a function so each render gets fresh, isolated state. */
export type MocksInput = Mocks | (() => Mocks);

// ---------------------------------------------------------------------------------------------
// Meta and stories
// ---------------------------------------------------------------------------------------------

interface BaseAnnotations<TArgs> {
  /** Default args; story args are merged over these. */
  args?: Partial<TArgs>;
  argTypes?: Partial<ArgTypes<TArgs>>;
  parameters?: Parameters;
  /** Outer to inner: meta decorators wrap story decorators. */
  decorators?: Array<Decorator<TArgs>>;
  mocks?: MocksInput;
  render?: StoryRender<TArgs>;
  play?: PlayFunction<TArgs>;
  /** Free-form tags; `!test` excludes a story from `rsc-stories test`. */
  tags?: string[];
}

/** The default export of a story file. */
export interface Meta<TComponent = AnyComponent> extends BaseAnnotations<PropsOf<TComponent>> {
  /** Sidebar path, `/`-separated. Derived from the file path when omitted. */
  title?: string;
  /** Explicit component id; keeps story ids stable across renames. */
  id?: string;
  /** The component under test: an async Server Component, a Client Component, or neither. */
  component?: TComponent;
  /** Export names (or patterns) to exclude from the story list. */
  excludeStories?: Array<string | RegExp> | RegExp;
  /** Export names (or patterns) to include in the story list. */
  includeStories?: Array<string | RegExp> | RegExp;
}

type ArgsFromMeta<TMeta> = TMeta extends { component?: infer C }
  ? unknown extends C
    ? Args
    : PropsOf<C>
  : TMeta extends Meta<infer C>
    ? PropsOf<C>
    : Args;

type MetaArgKeys<TMeta> = TMeta extends { args: infer A } ? keyof A : never;

// Index signatures (`Record<string, unknown>` when there is no component) are never required.
type RequiredKeys<T> = {
  [K in keyof T]-?: string extends K ? never : number extends K ? never : object extends Pick<T, K> ? never : K;
}[keyof T];

/** `params`/`searchParams` page props can come from `mocks.next` (`pageProps: true`). */
type PageProps = 'params' | 'searchParams';

type StoryArgs<TArgs, TProvided extends PropertyKey> = Omit<TArgs, TProvided | PageProps> &
  Partial<Pick<TArgs, Extract<keyof TArgs, TProvided | PageProps>>>;

/** One story. `args` becomes required when the component has required props `meta.args` lacks. */
export type StoryObj<TMetaOrComponent = Meta> = Omit<BaseAnnotations<ArgsFromMeta<TMetaOrComponent>>, 'args'> & {
  /** Display name; defaults to the export name in Start Case. */
  name?: string;
  /** Explicit story id suffix; keeps the id stable across renames. */
  id?: string;
} & (RequiredKeys<StoryArgs<ArgsFromMeta<TMetaOrComponent>, MetaArgKeys<TMetaOrComponent>>> extends never
    ? { args?: Partial<ArgsFromMeta<TMetaOrComponent>> }
    : {
        args: StoryArgs<ArgsFromMeta<TMetaOrComponent>, MetaArgKeys<TMetaOrComponent>>;
      });
