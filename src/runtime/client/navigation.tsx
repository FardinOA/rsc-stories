import { useContext, useMemo, type Context, type ReactNode } from 'react';
import { toPreview } from '../../shared/preview';
import { post } from './channel';

/** The router surface `useRouter()` returns in the App Router. */
interface RouterLike {
  back(): void;
  forward(): void;
  refresh(): void;
  hmrRefresh?(): void;
  push(href: string, options?: unknown): void;
  replace(href: string, options?: unknown): void;
  prefetch(href: string, options?: unknown): void;
}

/** Next's internal contexts, injected by the generated app so this package never imports `next`. */
export interface NavigationContexts {
  AppRouterContext: Context<RouterLike | null>;
  PathnameContext: Context<string | null>;
  SearchParamsContext: Context<URLSearchParams | null>;
  PathParamsContext: Context<Record<string, string | string[]> | null>;
  NavigationPromisesContext?: Context<unknown>;
}

export interface NavigationMockProps {
  pathname: string;
  searchParams: Record<string, string | string[]>;
  params: Record<string, string | string[]>;
  children: ReactNode;
}

function report(method: string, args: unknown[]): void {
  post({ type: 'router', method, args: args.map((arg) => toPreview(arg)), time: performance.now() });
}

/**
 * Builds the provider that mocks `useRouter`, `usePathname`, `useSearchParams` and `useParams`
 * for the story subtree. Router calls are recorded instead of navigating; `refresh()` re-runs the
 * story's server render through the real router.
 */
export function createNavigationMock(contexts: NavigationContexts) {
  const { AppRouterContext, PathnameContext, SearchParamsContext, PathParamsContext, NavigationPromisesContext } = contexts;

  function NavigationMock({ pathname, searchParams, params, children }: NavigationMockProps) {
    const realRouter = useContext(AppRouterContext);
    const router = useMemo<RouterLike>(
      () => ({
        back: () => report('back', []),
        forward: () => report('forward', []),
        refresh: () => {
          report('refresh', []);
          realRouter?.refresh();
        },
        hmrRefresh: () => realRouter?.hmrRefresh?.(),
        push: (href, options) => report('push', options === undefined ? [href] : [href, options]),
        replace: (href, options) => report('replace', options === undefined ? [href] : [href, options]),
        prefetch: (href) => report('prefetch', [href]),
      }),
      [realRouter],
    );
    const searchKey = JSON.stringify(searchParams);
    const search = useMemo(() => {
      const query = new URLSearchParams();
      const entries = Object.entries(JSON.parse(searchKey) as Record<string, string | string[]>);
      for (const [key, value] of entries) {
        for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
      }
      return query;
    }, [searchKey]);

    let tree = children;
    // Next 16 reads navigation hooks from this context in development; clear it so mocks win.
    if (NavigationPromisesContext) {
      tree = <NavigationPromisesContext.Provider value={null}>{tree}</NavigationPromisesContext.Provider>;
    }
    return (
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value={pathname}>
          <SearchParamsContext.Provider value={search}>
            <PathParamsContext.Provider value={params}>{tree}</PathParamsContext.Provider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    );
  }
  return NavigationMock;
}
