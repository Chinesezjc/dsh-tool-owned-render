# dsh-tool-owned-render

A DSH plugin that makes tool result rendering **tool-owned**: each tool registers its own React component on the keyed `tool.call.toolview` slot and composes shared layout primitives, instead of a central skeleton owning a render-kind union.

Design note (EN/ZH) and interactive prototype live alongside this file: [`docs/tool-owned-render.md`](docs/tool-owned-render.md) and [`prototype/unified-list-of-blocks-mock.html`](prototype/unified-list-of-blocks-mock.html).

## What it provides

**Primitives** — `ToolCard` (frame), `Segment` (the IN/OUT unit), `Group` (one execution inside a multi-execution call), plus `Lamp`, `Pill`, `Meta`, `ErrorText`.

The load-bearing structure follows the design prototype: a Segment's scroll area is a two-column grid, `[gutter][text]`, and the gutter is **role-exclusive** — an IN segment puts the **lamp** there, an OUT segment puts **line numbers** there. So the lamp and the line numbers share one column and align vertically. There is no title bar and no textual IN/OUT label; the IN segment's first line *is* the header, and OUT is separated by a rule.

**The lamp** — one observational status derivation, offered as a helper rather than imposed. It replaces the two-step derivation ui-tool currently writes three times, and it maps the whole `*_ABORTED` family plus the client-synthesised `interrupted` code to **amber**, so a cancelled call stops reading as a crash.

**Registrants**

| key | shape |
| --- | --- |
| `read` | OUT gutter carries the file's own line numbers |
| `bash` | OUT gutter stays empty; a non-zero exit or a killing signal shows an exit pill and turns the lamp red even though the call settles `isError: false`. The model-written `description` is the collapsed header, with the workdir before it when the call passed one; the raw command moves into the expanded body |
| `write` / `edit` | changed lines carry their number in the gutter, red for a deletion and green for an addition — no `+`/`-` prefixes — with `+n -m` on the summary line |
| `grep` / `glob` | grep groups matches under file heads and numbers each match; glob lists paths with an empty gutter. A capped result adds a second OUT segment carrying the recovery note |
| `web_search` / `web_fetch` | search puts the source ordinal in the gutter and renders each title as a link followed by its host, with the provider's answer as a wrapping row above; fetch splits into a status segment (`HTTP 200`, green when 2xx) and a capped body segment |

Every row in this table was verified against a real server and a real model round, `web_fetch` included.

`web_fetch` needs one extra step to become observable, because the shipped `@deepseek-ai/dsh-web-app` bundle sets `disabled: true` on the whole `tool-web` row ([`cordis.patch.yml:407`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/web-app/cordis.patch.yml#L407)), so neither `web_search` nor `web_fetch` comes from it on the web surface by default. A later layer re-enables the row:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: tool-web
  disabled: false
```

That the override works is measured, not inferred: `--dump-config` reports the row's `disabled` as `false` with the patch applied and `true` without it, and enabling it yields exactly one `web_search` and one `web_fetch` — no duplicates against the web profile's own web service.

With the row enabled, both web cards were driven in a browser on a real instance.

`web_fetch`: the disclosure toggle flips `aria-expanded` `false` → `true`, the status segment renders `HTTP 200` in `rgb(34, 197, 94)` via `statusOk`, and the body segment caps at `max-height: 132px` and scrolls horizontally (`scrollWidth` 819 > `clientWidth` 737) rather than wrapping — the prototype's `white-space: pre` default, which it applies `normal` to only for search answers.

`web_search`: a real 8-source round puts ordinals `1`–`8` in the gutter with every title a real `href` followed by its host, and the OUT segment caps at `max-height: 132px` and scrolls (`scrollHeight` 192 > `clientHeight` 148). The provider returned no answer for that query, so no blank-gutter answer row was rendered — the absent-answer path, which `hasAnswerRow` covers in both directions. The hover toolbar is `position: absolute` over the rows at `opacity: 0` until hover, as in the prototype, which reserves right padding only on the IN line.

## Install

The plugin must be loaded by the host so the client-modules scanner discovers its browser half. Add it to `~/.dsh/cordis.patch.yml`:

```yaml
- insert:
    - id: tool-owned-render
      name: 'dsh-tool-owned-render'
```

The package must also be resolvable by that name; during development a symlink into `~/.dsh/node_modules` is enough. Confirm both landed with `dsh --profile web --dump-config`, which prints the merged tree and annotates each row with the file that patched it — the row should appear at the end, attributed to your overlay.

Then restart `dsh web`. A restart is required because host rows are read only at boot: rebuilding `lib/client.js` alone refreshes the browser half (the boot manifest's `rev` changes), but adding or removing the host row does not take effect until the process restarts.

Layering, in application order: each bundle in the profile's `package.json` `dsh.profile.bundles`, then `$DSH_HOME/cordis.patch.yml`, then `$DSH_HOME/profiles/<name>/cordis.patch.yml`, then any `--patch` overlay. A later layer wins per row, so a profile-level patch can re-enable something a bundle disabled.

## Takeover semantics

Registering a key the shipped composition already covers **replaces** it — the keyed slot replaces rather than shares. This package registers at `priority: -1` because the shipped registrants use the default `0` and the slot resolves **lowest-priority-renders**. Verified against the real `SlotCore`, including negative controls: a higher priority does not take over, and an equal priority throws rather than silently sharing.

Because registering a key suppresses the fallback for *every* result under that key, a registrant must cover all the shapes its tool settles into — not only the happy one. `ReadRow` covers running, a settled read window, a cancelled read, and a settled call whose result view is missing or is not a read card.

## Scope

This is the client-side half of the design. Four things need host changes and are **not** possible from a plugin:

- **bash's structured `presentationMeta`.** The projection reads `tool.output.presentationMeta` — the function the tool itself declared at registration. A `tools/execute` hook can change a result's *value* but cannot add that function to someone else's tool. Measured: on the success path a hook-supplied `meta` is dropped (the error path preserves it).
- **`TerminalResultView.timedOut`.** Extends a closed union in the host's `presentation.ts`, so a timed-out command settles a non-zero exit and reads red rather than amber — indistinguishable from a crash.
- **`FileDiff` start lines.** `FileDiff` carries only `path`/`oldText`/`newText`; the executed hunk's `oldStart`/`newStart` are dropped host-side. This plugin therefore derives line numbers by diffing the two texts, which matches for an edit but can only number a new file or an overwrite from 1.
- **The diff's resolved path.** `edit` resolves the model's `file_path` through `ctx.fs.resolve` and returns the canonical `target.displayPath` as `value.path`, but both `presentationMeta` and `presentResult` publish `args.file_path` instead ([`edit.ts:108`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/tool-fs/src/edit.ts#L108), [`:165`](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/fs/tool-fs/src/edit.ts#L165)). The canonical path never reaches the client, so a card shows the path as the model wrote it (`~/x`), not the path that was actually written.

  This plugin does **not** try to normalise paths to compensate. Whether `~/x` and `/home/user/x` are one file depends on the sandbox `workspaceRoot`, the session cwd, the fs backend, symlinks, and case sensitivity — none of which the client can see, and guessing wrong is harmful in both directions (merging two files hides a change; splitting one file inflates the file count). It counts distinct path strings instead, which is exact for the data that actually arrives: one `edit`/`write` call carries one `file_path`, and `computeHunkDiffs` repeats that same string for every hunk, so the entries of one call are always byte-identical.

- **Retiring ToolRow's central card-kind chain.** A plugin shadows it; it cannot delete it.

## Development

```sh
npm ci            # installs from package-lock.json
npm test          # 69 unit tests
npm run typecheck
npm run bundle    # build lib/index.js, lib/index.d.ts, lib/client.js
```

`npm ci` rather than `npm install`: the client packages this plugin builds
against are pre-release, and their peer ranges (`^0.1.0-rc.8`) resolve forward
across the whole `@deepseek-ai/dsh-client-*` set. Installing without the
lockfile lets those peers drift apart into an unsatisfiable graph.

The `web-row` tests were each checked with a negative control — the assertion was confirmed to fail against a deliberately broken implementation before being kept.
