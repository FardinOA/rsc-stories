# Changesets

Every pull request that changes published behavior adds a changeset:

```sh
pnpm changeset
```

Pick `patch` for fixes, `minor` for features, `major` for breaking changes (while the version is
`0.x`, breaking changes are `minor`). Describe the change for users, not the implementation. The
release workflow turns pending changesets into a version bump and a CHANGELOG entry.
