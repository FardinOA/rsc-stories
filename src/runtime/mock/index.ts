// Used by the module and Next.js shims generated into the workshop app. Kept free of React and of
// Node built-ins so a shim imported from a Client Component bundles cleanly for the browser.
export { createModuleMock, primitiveExports } from './module-mock';
export {
  createCacheShim,
  createHeadersShim,
  createNavigationShim,
  NAVIGATION_DIGEST,
  parseNavigationDigest,
  StoryNavigationError,
} from './next';
