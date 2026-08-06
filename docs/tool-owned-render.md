# Agent Note: Tool-owned render — a layout package tools compose

Status: proposed

English | [中文](2026-08-03-unified-list-of-blocks-tool-render.zh.md)

## Problem

Every tool result card in the web UI is a bespoke primitive with its own data shape, its own CSS geometry, and its own place in a hand-maintained dispatch chain. There are five tool-result cards — `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, `WebBlock` — plus the generic fallback row and the shared code surface `CodeBlock`, and they agree on nothing structural:

- **Status is derived in four places.** Only `TerminalBlock` carries a run-state indicator *inside* the card (a single `StateDot` for the whole call, on the first prompt row only, at [TerminalBlock.tsx:240](../../../../packages/client/ui-primitives/src/TerminalBlock.tsx#L240), plus an exit-code/signal `Pill`). The other four cards carry none; their success, failure, and stopped states are painted by the surrounding row chrome. The derivations do not share a source: `ToolRowState` ([tool-call-model.ts:23](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L23)), `terminalFailed` ([terminal-card-model.ts:71](../../../../packages/client/ui-conversation/src/client/contract/terminal-card-model.ts#L71), needed because a failing bash command settles with `isError: false`), `StateDotState`'s four values, and `TerminalBlock`'s own internal running/exit/signal mapping are four independent encodings of the same idea.

- **"Input" has no shared representation.** Only `terminal` (command/cwd/description) and `diff` (`FileDiff[]`) declare a structured call view. `read`, `grep`, `glob`, `web_search`, `web_fetch` fall to a `card: 'generic'` call view — a `title` string (read adds a `kind` and `locations`), with the row otherwise deriving its summary and body from the raw `argsRaw` JSON ([tool-call-model.ts](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts)); grep's `path`/`include` survive only as substrings of `"Grep X in Y (Z)"`. The only place an actual IN/OUT segment pair is rendered today is the generic fallback `div.ioCard` ([ToolRow.tsx:294](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L294)), which is hardcoded inside `ToolRow`, supports exactly two segments, and cannot nest or be reused.

- **The dispatch is a central chain, written twice.** Choosing which card a tool renders as is a multi-arm chain — a nested ternary in [ToolRow.tsx:258](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L258) and again, in a different order, an if/return chain in [DetailsPanel.tsx:150](../../../../packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx#L150). Adding or changing one tool's rendering means editing this shared central chain (and its twin) plus that tool's `*-card-model` — so no tool's presentation can change in isolation.

- **Structure is duplicated by convention, not shared by code.** There is no shared card shell (`grep -rn CardShell` = 0). Five CSS modules each declare a `.block` root repeating the same four properties and each defining its own `--dsl-<name>-radius: 12px` and `--dsl-<name>-line-height: 22px` (`WebBlock` declares only the radius). `headTailCap` and `useCopyFeedback` each have exactly two callers; `ReadBlock` and `DiffBlock` inline the identical head/tail arithmetic and 1000 ms copy timeout with hardcoded Chinese literals. Three `CHAT_*_MAX_LINES = 8` constants repeat the same comment.

- **i18n is asymmetric.** Only `TerminalBlock` has a full `TerminalBlockLabels` surface; the other four cards inline Chinese literals — [ui-primitives/README.md](../../../../packages/client/ui-primitives/README.md) records the gap for `WebBlock` alone, the other three being unrecorded.

The precipitating need is interactive, multi-command bash: a single bash call will run several commands, and a persistent/interactive session (a REPL, a PTY) will exchange stdin/stdout in multiple rounds. Neither fits `TerminalBlock`'s flat "one card, one command banner, one output box, one status" shape. Extending only bash would add a sixth bespoke variant on the central chain.

## Proposal

Two design principles decide the shape, and the rest follows from them:

1. **A tool's presentation must change in isolation** — editing one tool's rendering touches only that tool's module, never a shared central switch or another tool.
2. **A tool author keeps the right to restructure their own presentation** — the layout is composable parts, not a fixed shell a tool must slot into.

So rendering is **tool-owned, not skeleton-owned**. Extract a client package — `@deepseek-ai/dsh-client-tool-render` — out of `ui-conversation` that holds three things and nothing tool-specific:

- **Layout primitives** a tool composes: `ToolCard`, `Segment`, `Group` (below), plus a default-composition helper for tools that just want the standard arrangement.
- **The registration interface**: the keyed `conversation.chat.toolview` slot declaration and the props a registered component receives (the tool's call view and result view).
- **Built-in registrants**: one self-contained module per built-in tool (`bash`, `read`, `search`, `web`, `write`/`edit`, …), each registering its own React component that composes the primitives and does its own wire→props. `ui-conversation` shrinks to the chat chrome (messages, compaction, queue, input) and mounts the slot.

There is **no central render dispatch and no central render-kind union**. The keyed slot *is* the dispatch: each tool call renders through the component registered under its tool name, or through the generic fallback when none is registered. Changing `read`'s rendering edits the `read` registrant module — its component and its wire→props — which depends only on the package's primitives; it touches no central switch, no shared union, and no other tool. Adding a new tool's rendering is a new registrant with zero central change. A third-party tool author depends on this one package and ships their own registrant.

An interactive prototype validating the visual shapes (all tool shapes, the stress cases) lives on the orphan assets branch, not in the tree: [`unified-list-of-blocks-mock.html`](https://github.com/deepseek-harness/deepseek-harness/blob/list-of-blocks-assets/unified-list-of-blocks-mock.html). It is a one-time design artifact — the note text, not the prototype, is the authority for what ships.

### The primitives: ToolCard / Segment / Group

The package exports composable parts, not a mandated hierarchy. A tool's component picks what it needs:

```
ToolCard   — the card frame (border, padding, the transcript row shell)
  Segment  — one IN or OUT content unit: a [gutter][body] grid with an
             optional lamp, optional line-number gutter, per-segment scroll
             and copy. This is the core unit; most tools compose Segments
             directly.
  Group    — OPTIONAL. Bundles several Segments under one lamp, for a tool
             with more than one observable execution unit (multi-command
             bash; interactive rounds). A single-execution tool never uses it.
```

- `Segment` is the only part most tools touch. `read` is `ToolCard` → an IN `Segment` (path + range) → an OUT `Segment` (numbered lines). No `Group`.
- `Group` is used only when a tool genuinely has multiple execution units in one call. It carries the lamp for that unit; nesting Groups (a recursion) is deferred (§recursion).
- `ToolCard` is the frame. A tool that wants to restructure its whole row draws its own frame with `ToolCard` (or replaces it); a tool that wants the standard row uses the default-composition helper. Row-frame consistency across tools is a convention the built-ins follow, not a lock — that is principle 2.

The names deliberately avoid the two collisions the earlier draft hit: they are **not** the `*Block` leaf family (`TerminalBlock` et al. remain the content renderers a Segment may embed), and `Group` is **not** the session model's `Turn` (`turn/start`/`turn/end`).

Vocabulary is tool-neutral: the primitives know only `Segment`, `role: 'in' | 'out'`, an optional lamp, and the tool-supplied content — not shell words (`command`/`cwd`/`exitCode`), because the same parts must carry a file read, a diff, a search query, and a fetched URL.

### The lamp: one observational derivation, offered as a helper

The package exports one lamp-state function over what the harness can observe; a tool's registrant feeds it the result and hands the state to a `Segment` or `Group`. It replaces today's four independent status derivations. A tool may pass its own state, but the shared helper is what makes every tool agree:

- **`isError === false` → green (done).** Completion is itself the observable signal. Base rule for *every* tool.
- **cancelled → amber (warn).** A dispatch-level abort persists `error.info.code` = `ABORTED` (or `ABORTED_BEFORE_DISPATCH`) on the result of *any* tool ([tools/index.ts:1180/1588/1602](../../../../packages/core/tools/src/index.ts#L1180)), terminal or not, so a cancelled read, web, or bash maps to amber. The helper checks this code *before* the generic error rule, because a cancelled result settles `isError: true` *and* carries the code — red-first would mis-map it.
- **error → red.** The tool reported `isError` and no `ABORTED` code.
- **running → blue** (the `ongoing` pixel-chase dot).
- **The terminal-card tools refine further** (bash, and `tool-pwsh` on Windows, which carry the same exit/signal/timeout fields and settle a non-zero exit with `isError: false`): `timedOut` → amber; a terminating `signal` not from our timeout/abort → red (a crash `SIGSEGV`, or an external `SIGTERM`; a `SIGTERM` we sent for a timeout is already caught by the amber rule); else the exit code decides.
- **grey (neutral)** only where an outcome is genuinely unobservable — an interactive-shell round whose outcome has no structured channel yet (below). The helper never parses a Traceback to invent a red lamp for something it cannot observe.

Attribution uses only the harness's own signals, never a guess at who sent an OS signal. `timedOut` lives in the bash result value on the success path a presenter never sees, so it rides the new bash structured result. A single-shell bash command aborted mid-run also persists `ABORTED` — the tool throws `HarnessError('tool call aborted', TOOL_ABORTED)` ([tool-bash/src/index.ts:385](../../../../packages/bash/tool-bash/src/index.ts#L385), pre-dispatch arm at :360) — so it is amber on replay with no deferred change. The client-synthesised `interrupted` code the `stopped` row state reads ([tool-call-model.ts:215](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L215), minted at [history-fold.ts:304](../../../../packages/client/runtime/src/client/session-history/history-fold.ts#L304)) maps to amber too. Three settled-abort shapes remain code-less and render red until their own PRs: a persistent-shell round abort ([tool-bash-persistent/src/index.ts:322-324](../../../../packages/pty/tool-bash-persistent/src/index.ts#L322)), its caller abort (:393), and a raw-PTY send abort ([tool-pty/src/index.ts:279](../../../../packages/pty/tool-pty/src/index.ts#L279)); making them amber needs each to persist a distinguishable code.

`warn` (amber) and `neutral` (grey) are the two states new relative to today's three-state `StateDot` use (`done`/`error`/`ongoing`); amber's token exists, grey has no `StateDotState` member or CSS rule today, so both are added. The lamp is colour-only and `aria-hidden`; each carries a matching accessible status text (the row's `stateStatus` pattern), so done/error/running/warn/neutral survive without colour.

### What a Segment gives a tool

A `Segment` is a `[gutter][body]` grid; the tool supplies the body, and the primitive provides the shared mechanics so no tool re-implements them:

- **Gutter, mutually exclusive by role.** An IN segment's gutter carries the **lamp** (far-left, first row only); an IN segment **never carries line numbers**, even when many lines (a heredoc script, a `run_code` program body, a big args JSON) — those lines are input, not file content. An OUT segment's gutter carries **line numbers** (right-aligned) only for OUTs that show *file content* (read, grep, diff); a diff's gutter shows real old/new line numbers, **not** `+`/`-` marks (red deletes / green adds colour the number and body; a deleted line and its replacement may show the same number). Non-file OUTs (bash output, web body, args JSON) leave the gutter empty.
- **One gutter width per `ToolCard`**, `max(lamp-min, widest line number)`, so every Segment's body starts on the same line; adaptive to a 6-digit number. Line numbers are always visible, never hover-hidden.
- **Per-segment scroll**: a Segment over a height cap becomes a fixed-height scroller; line numbers scroll with the body, the lamp is pinned to the non-scrolling shell. Long lines overflow horizontally; indentation is never folded. The scrollbar reuses ui-theme's themed-scrollbar token pair (`--dsh-scrollbar-thumb`/`-hover`) rather than a self-drawn overlay, following [the pointer-revealed-scrollbars note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md): `transparent` at rest, the surface's l2 pair while pointed at, over the reserved gutter ([reserved-gutter note](../../implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)) so nothing shifts. A drawn thumb on an elevated surface uses the l2 pair; a resting `transparent` thumb draws nothing so owes no l2 — the *hiding no longer counts as elevating* clause.
- **Per-segment copy** (IN and OUT each have one — copying command and output are separate; there is no whole-card copy). Controls anchor to the segment's non-scrolling top-right, revealed on hover / `:focus-within` / touch.
- **Type sizes** match the existing cards (the 13px/22px `--dsw-font-*` code-block tokens), per design review.
- A segment renders **no** verb badge (`READ`/`WRITE`): the tool row's icon and title already name the tool.

Empty and input-less segments collapse symmetrically: an empty OUT collapses its height to zero but keeps its border (two adjacent divider lines — "output region, empty"); an input-less OUT (a generic console dump) carries the lamp itself on its first row and has no command row.

### Each tool as a registrant

Each built-in tool is a self-contained registrant module: a React component that composes the primitives and does its own wire→props, registered under its tool-name key. The table is what each tool's component renders — not a set of central "kinds":

| Tool | IN | OUT | Lamp |
|---|---|---|---|
| bash (1 cmd) | prompt line: cwd + command | output text (no line numbers) | exit/signal/timeout/abort |
| bash (N cmds) | the raw `command` as one prompt line (single `command`; per-command split is the deferred executor change) | merged output | one lamp for the whole call today; per-command `Group`s need the deferred executor change |
| bash (interactive) | prompt line for the round | round output | each round is its own `bash` call; per-round done/error needs the persistent tool's canonical value to retain the round exit code first (today it reaches persisted data only as the non-zero `[exit code: N]` marker, and `tool-bash-persistent` has no structured result) — deferred; grey until then |
| read | path + line range | numbered file lines | done/error |
| write / edit | `path` | applied diff, real (old/)new line numbers | done/error |
| grep | query + scope | match groups (line numbers) + recovery locator (2nd OUT) | done/error |
| web_search | query | answer + numbered source list (clickable `http(s)`-only links, reusing `SafeLink`) | done/error |
| web_fetch | url | status line (1st OUT) + fetched body (2nd OUT) | done/error |
| generic (fallback) | args JSON | result text | done/error |

A **running** call renders with a pending OUT and a blue lamp; the IN comes from the tool's call view (`terminal`'s command/cwd, `diff`'s `FileDiff`, `read`'s `kind`/`locations`). A call view carrying only a `title` renders that title as the running IN — a bounded reduced-fidelity case each tool closes by enriching its own `presentCall`, not a new view. write/edit keep the running-state call-time diff (the intended change as the OUT while in flight, replaced by the applied diff at settle); the code variant's program body (`run_code`, `cordis_mount`) renders as a monospace, syntax-highlighted IN segment (no line numbers) reusing the repo's shiki integration.

### Two paths for a tool, no declarative middle

There are exactly two ways a tool reaches the UI:

1. **Write a component (the main path).** The tool's registrant composes the primitives — full control, restructurable in isolation. Built-in tools use this; a tool that wants convenience composes the default helper; a tool that wants to restructure everything draws its own `ToolCard`.
2. **Generic fallback (zero code).** A tool with no registrant renders as IN = args JSON, OUT = result text through the package's generic registrant — so it still gets the lamp, gutter, scroll, and copy, instead of today's threadbare `ioCard`.

There is **no central render-kind union and no declarative middle tier.** A closed union of render kinds with a central `assertNever` switch was considered and rejected: adding a kind is a compile-breaking change at the shared switch, which is exactly "you cannot change one tool in isolation" — it violates principle 1. Tools that want to share content rendering **compose** the existing leaf components (`ReadBlock`, `DiffBlock`, `TerminalBlock`, `CodeBlock`) inside their Segments; that is composition, not a central switch.

### Data source: the text-reconstructable boundary is preserved

Whether a tool needs structured data beyond the model-facing result text is unchanged by this work. bash can reconstruct `command`/`cwd`/exit from args and output, which is why it is the one card that does **not** use `presentationMeta` today (it gains one here, replacing its `parseExitStatus` text round-trip). read's line numbers, search's groupings, and web's sources are lossy in text, so they ride `presentationMeta` — the only structured channel that survives replay, since `ToolEventView` is never persisted ([api/events.ts](../../../../packages/host/apiproxy/src/api/events.ts)). A registrant reads the tool's call/result view (the client never sees `presentationMeta` directly; it is the host-side projection input). The invariant **Model-visible ⟺ logged** ([AGENTS.md:100](../../../../AGENTS.md#L100)) holds: the model sees flattened text, the UI sees the structured view, both from the same execution.

### Recursion is deferred entirely

Nesting `Group`s — a group of executions folding into one collapsible unit with an aggregated lamp — is **deferred entirely, no field in the type**: no aggregation rule, no recursive renderer, no group summary. It would need status aggregation across the five lamp states, a group-title source bash does not provide, and a localized fold summary — none of which the motivating needs (multi-command, interactive) require. When built, it lands as a compile-breaking type extension alongside its consumer.

### Migration shape

**PR 1 — extract the package + primitives + bash + one tool.** A stacked PR series (each step bases on the previous), one concern each:

1. **Extract `@deepseek-ai/dsh-client-tool-render`.** Move the `conversation.chat.toolview` slot declaration and the registrant props contract out of `ui-conversation/contract/slots.ts` into the new package; `ui-conversation` depends on it and still mounts the slot. Mechanical; no behaviour change, no visual change. Existing per-tool registrants keep working unchanged.
2. **The primitives** (`ToolCard`/`Segment`/`Group` + the default helper + the lamp helper) in the new package, built on `ui-primitives`: the one lamp derivation, adaptive gutter, per-segment scroll + themed scrollbar, per-segment copy. Component unit + render snapshots, including a multi-Group card exercising the optional grouping.
3. **bash** converted to a registrant composing the primitives, with a new bash `presentationMeta` carrying the structured result (command, cwd, output, exit/signal/timeout/timedOut). First real tool — the snapshot/e2e coverage that needs real tool data lands here. A multi-command call is one Group today (per-command Groups are the deferred executor change).
4. **One more tool** (read or search) converted, proving the primitives are genuinely tool-neutral, not bash-shaped; its own snapshot/e2e.

**PR 2 — convert the remaining tools and delete the central dispatch.** Once the primitives are validated, convert each remaining tool to a self-composed registrant — read/search leftover, write/edit, grep/glob, web_search/web_fetch, the code variant `run_code`/`cordis_mount`, and `tool-pwsh` (same terminal shape); the persistent-shell and PTY tools follow once they gain a structured per-round result. Then **delete the central chain**: the `ToolRow` ternary, the `DetailsPanel` if/return twin, and the five `*-card-model`s all go — the keyed slot is now the only dispatch. Retire the per-block `.block` geometry and the duplicated cap/copy code; unify the `CHAT_*` constants; fold i18n into one labels surface. Delivered as a per-tool-group stack (write/edit; grep/glob; web) since a single ~8–10k-line PR would be unreviewable.

**PR 3 — side preview panel.** A resizable, right-docked, singleton preview container (click-to-replace, with a second-level expand to true fullscreen), evolving today's `DetailsPanel` Output pane, opened by a per-segment `⤢` button. It renders a tool's own registrant component (not a separate dispatch), so it inherits every tool's presentation for free. Separate, lower-priority; the earlier PRs neither render nor reference it.

**Later** — per-command `Group` capture for a joined multi-command call and a structured per-round result for the persistent/PTY tools (both executor/backend changes the primitives already admit — a producer emits more `Group`s / a value retains the exit code), nested-`Group` recursion and the per-behaviour status shapes (streaming, background tasks, approval-required, sandbox denial — new fields, each a compile-breaking extension alongside its consumer), and code-less abort codes that would make persistent/PTY aborts amber. Each lands with the behaviour it serves.

This note's owning work is PR 1; PR 2 (full conversion + central-dispatch deletion) precedes PR 3 (side preview panel).

## Alternatives considered

- **A central skeleton that owns rendering, tools supplying declarative render kinds.** This was the earlier draft: one `Block`/`Turn`/`Segment` skeleton with a closed render-kind union and an exhaustive `assertNever` switch; tools describe their segments by picking kinds. Rejected against principle 1: adding or changing a kind is a compile-breaking edit at the shared central switch, so a tool's presentation cannot change in isolation — and against principle 2: a tool cannot restructure beyond the kinds the union offers. The tool-owned model keeps the same *visual* result (composed primitives) without the central coupling.

- **Extend only bash to multi-command, leave the other four cards alone.** Rejected: the "input is a title string", "status lives outside the card", and "OUT is already two things" problems are shared across tools, not bash-specific, and the central dispatch chain grows a sixth arm either way.

- **A flat `Segment[]` stream, no `Group`.** Rejected: it deletes "which segments belong to one execution" from the data, forcing the renderer to infer grouping; interactive sessions (one process, many rounds) then cannot be distinguished from independent commands. `Group` is optional but carries that fact when present.

- **A mandated central card shell tools slot into (chrome fully owned centrally).** Rejected against principle 2: it constrains a tool to the shell's arrangement. The package instead exports parts a tool composes, with a default helper for the common case — consistency by convention, not by lock.

- **Per-tool sibling packages (each tool ships its own render package).** Rejected as too heavy: backend tool packages cannot import React, so each would need a sibling client package. One extracted render package with per-tool registrant modules gives the same isolation (edit one module) at a fraction of the package count.

- **Expand as a centred modal / fullscreen takeover.** Rejected in favour of the resizable right-docked side preview panel (singleton, click-to-replace, optional second-level fullscreen) plus per-segment scroll; the panel keeps the conversation visible and reuses each tool's registrant.

- **Self-drawn overlay scrollbar.** Rejected — the same call [the pointer-revealed-scrollbars note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md) made: it costs hit-testing, drag, wheel, momentum, and both palettes' hover states for a cosmetic gain. The primitives reuse ui-theme's token indirection instead.

## Acceptance criteria

- `@deepseek-ai/dsh-client-tool-render` exists, holding the `conversation.chat.toolview` slot declaration + registrant props, the `ToolCard`/`Segment`/`Group` primitives + default helper, and the lamp helper; `ui-conversation` depends on it and mounts the slot. The slot extraction (PR 1a) changes no behaviour and no pixels (snapshot unchanged).
- bash and one other tool render as registrants composing the primitives; the four current status derivations are replaced by the one lamp helper for those two tools.
- bash carries its structured result (command, cwd, output, exit/signal/timeout/timedOut) via `presentationMeta`; its `parseExitStatus` text round-trip is gone; the model-facing bash text is unchanged (snapshot). A single-command call renders with one lamp; a joined multi-command call is one `Group` (per-command `Group`s are the deferred executor change); the single-command case is visually equivalent to today's `TerminalBlock` (snapshot).
- One gutter width per `ToolCard` aligns every Segment's body; line numbers are always visible; empty and input-less segments collapse per the rules; per-segment IN/OUT copy works.
- Changing a converted tool's rendering touches only that tool's registrant module (demonstrated by 1d touching no bash file); no central render dispatch and no render-kind union exist after PR 2.
- The full test matrix ships (unit per-file 100%, real-API e2e, keyless snapshot, web-browser snapshot where the surface applies, smoke, CI gates, sandbox), including a keyless snapshot through a real runnable example asserting the assembled transcript. Coverage concentrates in the PRs with a real tool producing a transcript.

## Risks

- **Scope.** This extracts a package and rewires every tool's rendering path plus the host→client view flow. It is staged (extract → primitives → bash → one tool → the rest) to bound each PR, and PR 1a (slot extraction) is behaviour- and pixel-neutral to de-risk the move.
- **Wire is untrusted.** `sessions.schema.ts` validates only `for` + `card: string`; every registrant MUST re-narrow its view defensively, or a malformed payload crashes its row — the same discipline the card-models keep today, now living in each registrant.
- **Replay purity.** Registrants and the lamp helper run on the live and replay paths and must stay pure functions of the view (args + result meta), no I/O, clock, or session state ([adding-a-tool.md](../../../../docs/cookbook/adding-a-tool.md)).
- **Consistency by convention.** Because a tool may restructure its whole row (principle 2), row-to-row visual consistency rests on the built-ins following the default helper rather than a central lock; the snapshot suite is what catches a drifting row.
- **What is given up.** Uniform status means the four cards that today show *no* in-card status (only `TerminalBlock` carries one) gain a lamp; for genuinely unobservable outcomes the honest value is grey, never a manufactured green. Three shapes are deferred: per-command `Group`s for a joined multi-command call; a structured per-round result so a *successful* persistent/PTY round can read as done (today a zero-exit round leaves no marker and those tools carry no structured result, so a pure presenter reconstructs only a failed persistent-shell round, and no raw-PTY round at all); and nested-`Group` recursion. Until they land, a multi-command call is one `Group` with one lamp, and each interactive round is its own card showing error on a non-zero exit and grey on success.
- **AGENTS.md drift.** [AGENTS.md:116](../../../../AGENTS.md#L116) still lists three card kinds; the render-intent union already has more. This work should update that line and the render-intent design note in the same PR.

## Supersedes

This proposal replaces the bespoke card renderers and their central dispatch layer, so it amends the Agent Notes that own those decisions. Partial, not full: the wire vocabulary, the `presentationMeta` boundary, and the generic fallback survive. The notes whose decisions this work supersedes are the render-intent union ([2026-07-02-tool-render-intent-union.md](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)) and the per-card records ([2026-07-28-web-terminal-card.md](../../implemented/feature/2026-07-28-web-terminal-card.md), [2026-07-30-web-read-card.md](../../implemented/feature/2026-07-30-web-read-card.md), [2026-07-30-web-read-card-frontend.md](../../implemented/feature/2026-07-30-web-read-card-frontend.md), [2026-07-30-web-search-card.md](../../implemented/feature/2026-07-30-web-search-card.md), [2026-07-30-web-diff-card.md](../../implemented/feature/2026-07-30-web-diff-card.md), [2026-07-30-search-render-card.md](../../implemented/feature/2026-07-30-search-render-card.md), [2026-07-30-web-result-card.md](../../implemented/feature/2026-07-30-web-result-card.md), [2026-07-30-web-result-card-frontend.md](../../implemented/feature/2026-07-30-web-result-card-frontend.md), [2026-07-31-web-cards-toolrow.md](../../implemented/feature/2026-07-31-web-cards-toolrow.md), [2026-07-30-web-tool-row-unified-expand-and-inspect.md](../../implemented/feature/2026-07-30-web-tool-row-unified-expand-and-inspect.md), [2026-08-03-web-search-source-scroll.md](../../implemented/feature/2026-08-03-web-search-source-scroll.md)), plus the render decisions (not the backend or executor decisions) in [persistent PTY sessions](../../implemented/feature/2026-07-16-persistent-pty-sessions.md) (its PTY tools' UI render intents) and [pwsh tool bash parity](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md) (its generic/terminal-card presentation choice), and the code-variant render decisions in [Code Mode chat sub-call rows](../../implemented/feature/2026-07-26-code-mode-chat-subcall-rows.md) (`run_code` sub-calls as native rows) and [the self-referential cordis toolset](../../implemented/feature/2026-07-08-self-referential-cordis-toolset.md) (`cordis_mount`'s generic card with the code expansion). Each superseded note carries a reciprocal cross-link to this proposal now, added in this PR — phrased as *slated for* partial supersession when this work's migration lands, with that note named the current authority until then, so the link asserts only a true present fact rather than a supersession that has not happened. The cross-link and the supersession assertion are separate obligations: the notes contract requires the link at note-writing time (`.agents/notes/AGENTS.md`, README), while the in-place fact updates to each superseded note land where its own superseding migration does, and only consolidation would wait for landing — which this partial supersession does not do.
