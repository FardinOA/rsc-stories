# Good first issues (to open at launch)

Each is scoped, has a clear acceptance test, and touches one area of the code. Open them on GitHub
with the `good first issue` label.

## 1. Copy a story's canvas URL from the toolbar

The canvas is a real Next.js route (`/rsc-stories/canvas/<file>/<export>/<state>`) that can be
opened on its own, which is handy for debugging with React DevTools. Add a toolbar button next to
"Copy link" that copies the current canvas URL.

- Where: `src/ui/components/Toolbar.tsx`, `desiredCanvasUrl()` in `src/ui/lib/actions.ts`
- Done when: an e2e test in `e2e/workshop.spec.ts` clicks the button and opens the copied URL in a
  new page, which renders the story.

## 2. `rsc-stories test --reporter junit`

CI systems display JUnit XML natively. Add `--reporter junit --output <file>` that writes one
`<testcase>` per story with failures as `<failure>` elements.

- Where: `src/node/commands/test.ts` (results are already collected as `StoryResult[]`),
  `src/cli/index.ts` for the flag
- Done when: a unit test in `tests/node/test-command.test.ts` checks the XML for a passing, a
  failing and a skipped story.

## 3. Show the matched fetch mock for each fetch call

The Calls panel lists `fetch` calls, but not which mock answered them. Each call record already
carries the mock's key (`fetch:<name>`, or `fetch:unmocked`). Show the mock's name in a column, and
"unmocked" for calls no mock answered.

- Where: `src/ui/panels/Activity.tsx` (the call records come from `src/shared/fetch-mock.ts`)
- Done when: the minimal example's `Quote` story shows the mock name in the Calls panel, covered by
  an e2e assertion.

## 4. Search stories by tag

Allow `tag:commerce` in the sidebar search to filter by story tags.

- Where: `src/ui/components/Sidebar.tsx`
- Done when: typing `tag:expect-error` in the minimal example lists only `Quote / Service Down`,
  covered by an e2e test.
