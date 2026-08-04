# Agent Note: Unified List-of-Blocks tool render

Status: proposed

English | [中文](2026-08-03-unified-list-of-blocks-tool-render.zh.md)

## Problem

Every tool result card in the web UI is a bespoke primitive with its own data shape, its own CSS geometry, and its own place in a hand-maintained dispatch chain. There are six — `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, `WebBlock`, `CodeBlock` — and they agree on nothing structural:

- **Status lives in six-plus places.** Only `TerminalBlock` carries a run-state indicator *inside* the card (a `StateDot` per prompt line at [TerminalBlock.tsx:240](../../../../packages/client/ui-primitives/src/TerminalBlock.tsx#L240) plus an exit-code/signal `Pill`). The other five carry none; their success, failure, and stopped states are painted by the surrounding row chrome. The derivations do not share a source: `ToolRowState` ([tool-call-model.ts:23](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L23)), `terminalFailed` ([terminal-card-model.ts:71](../../../../packages/client/ui-conversation/src/client/contract/terminal-card-model.ts#L71), needed because a failing bash command settles with `isError: false`), `StateDotState`'s four values, and `TerminalBlock`'s own internal running/exit/signal mapping are four independent encodings of the same idea.

- **"Input" has no shared representation.** Only `terminal` (command/cwd/ description) and `diff` (`FileDiff[]`) declare a structured call view. `read`, `grep`, `glob`, `web_search`, `web_fetch` collapse their entire multi-field input into a single English `title` string plus a `rawInput` string; grep's `path`/`include` survive only as substrings of `"Grep X in Y (Z)"`. The only place an actual IN/OUT segment pair is rendered today is the generic fallback `div.ioCard` ([ToolRow.tsx:279](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L279)), which is hardcoded inside `ToolRow`, supports exactly two segments, and cannot nest or be reused.

- **Structure is duplicated by convention, not shared by code.** There is no `CardShell` (`grep -rn CardShell` = 0). Five CSS modules each declare a `.block` root repeating the same four properties and each defining its own `--dsl-<name>-radius: 12px` / `--dsl-<name>-line-height: 22px`. `headTailCap` and `useCopyFeedback` each have exactly two callers; the other three blocks inline the identical arithmetic and the identical 1000 ms copy timeout with hardcoded Chinese literals. Four `CHAT_*_MAX_LINES = 8` constants repeat the same "half the primitive default" comment. The wire→props dispatch is a six-arm ternary written once in [ToolRow.tsx:240](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L240) and again — in a different order — in [DetailsPanel.tsx:150](../../../../packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx#L150).

- **i18n is asymmetric.** Only `TerminalBlock` has a full `TerminalBlockLabels` surface; the other four inline Chinese literals, a gap already recorded in [ui-primitives/README.md](../../../../packages/client/ui-primitives/README.md).

The precipitating need is interactive, multi-command bash: a single bash call will run several commands, and a persistent/interactive session (a REPL, a PTY) will exchange stdin/stdout in multiple rounds. Neither fits `TerminalBlock`'s flat "one card, one command banner, one output box, one status" shape. Extending only bash would add a seventh bespoke variant. The same List-of-Blocks structure that interactive bash needs is the structure that unifies all six cards, so the foundation is worth laying once for all of them rather than bolting a bespoke multi-command mode onto bash alone.

## Proposal

Introduce one shared render skeleton with a three-level structure, and express all six existing cards — plus interactive/multi-command bash — as instances of it. The skeleton owns everything common (layout, the status lamp, the alignment gutter, per-segment scroll, copy, fullscreen); each tool supplies only how its own input and output render.

An interactive prototype validating this design (all tool shapes, the stress cases, and the blind-spot render kinds) lives on the orphan assets branch, not in the tree: [`unified-list-of-blocks-mock.html`](https://github.com/deepseek-harness/deepseek-harness/blob/list-of-blocks-assets/unified-list-of-blocks-mock.html). It is a one-time design artifact — the note text, not the prototype, is the authority for what ships.

### The three levels: Block / Turn / Segment

```
Block    整卡 — one tool call's whole card
 └─ Turn  一对 IN/OUT + one lamp — bash: one per command; REPL: one per round
     ├─ Segment (IN)  — this operation's input representation
     └─ Segment (OUT) — its output; a tool may emit more than one (grep: matches
                        + recovery locator; web_fetch: status line + body)
```

`Block` is *not* a list; it is the card object that holds a list of `Turn`s; each `Turn` holds its `Segment`s. The outer List-of-Blocks in the UI is one `Block` per tool call.

Vocabulary is deliberately tool-neutral: the field names are **not** shell words (`command`/`cwd`/`exitCode`), because the same skeleton must carry a file read, a diff, a search query, and a fetched URL. Each tool provides a renderer for its own IN payload and OUT payload; the skeleton knows only `Segment`, `role: 'in' | 'out'`, an optional `lamp`, and the tool-supplied render.

### The lamp: one observational derivation

Today's four status derivations collapse into one function over what the harness can observe, attached at the `Turn` level (rendered in the IN segment's gutter):

- **`isError === false` → green (done).** Operation completed without error — that completion is itself the observable signal. This is the base rule for *every* tool: a read, a write, a search that simply succeeded is green. There is no manufactured "success" beyond "it finished and did not error".
- **error → red.** The tool reported `isError`.
- **running → blue** (the `ongoing` pixel-chase dot).
- **bash refines further** because it has an exit code the other tools lack: `timedOut`/`aborted` → **amber (warn)** (the harness terminated it on a limit or cancellation — the command had no choice); a terminating `signal` not from our timeout/abort → **red** (crash `SIGSEGV`, or an external `SIGTERM`; a `SIGTERM` we sent for a timeout is already caught by the amber rule, so any signal reaching here is externally sourced); else the exit code decides.
- **grey (neutral)** only where an outcome is genuinely unobservable — e.g. a REPL turn (`>>> 2+2`) has no shell exit code, so it is grey. The skeleton never parses a Traceback to invent a red lamp for an outcome it cannot observe.

`warn` (amber) is the one new state relative to the current three-state `StateDot` use; the token already exists ([StateDot.module.css](../../../../packages/client/ui-primitives/src/StateDot.module.css)). Signal attribution uses only the harness's own booleans (`timedOut`/`aborted`), never a guess at who sent a signal, because the OS does not report the sender.

### No verb label inside the card

A segment's IN renders the tool's real input (bash: the prompt line; read: path + line range; write/edit: path; grep: query + scope; web: query/url; generic: args JSON). It carries **no** `READ`/`WRITE`/`GREP` verb badge — the enclosing tool row already shows the tool's icon and title, so repeating it inside the card is redundant.

### The alignment gutter: lamp and line-number share one column, mutually exclusive

Every Segment is a two-column grid `[gutter][body]`. The gutter's content is **mutually exclusive by role**:

- IN segment → the **lamp** (left-aligned, pinned to the far left). An IN segment **never carries line numbers**, even when it is many lines (a heredoc running a whole script, a large `write` content, a big args JSON): its lines are the operation's input, not file content, so they have no "line N". Only the lamp occupies its first-row gutter; every other IN row's gutter is empty.
- OUT segment → **line numbers** (right-aligned, hugging the body line), only for the OUTs that show *file content*: read (file line numbers), grep (matched file line numbers), diff (actual old/new line numbers — the gutter shows real line numbers, **not** `+`/`-` marks; red deletes / green adds colour the number and the body; a deleted line and its replacement can both show the same number, and that side-by-side repeat is accepted rather than introducing a two-column old/new gutter). Non-file OUTs (bash output, web body, args JSON, a custom tool's text) have no line numbers and leave the gutter empty.

Because the lamp lives on the IN segment and line numbers on the OUT segment, "one column, mutually exclusive" holds naturally — a given segment's gutter has only one kind of content.

**One gutter width per Block, computed to align every Turn.** The gutter column width is `max(lamp-min, widest line number in this Block)`; all IN and OUT segments in the card share it, so IN commands, OUT text, and numbered rows all start on the same body line. The width is adaptive (a 6-digit line number widens the gutter and shifts the body line; the lamp stays pinned far-left). In the prototype this is measured in JS; the shipped component computes it the same way (measure widest gutter content, set a CSS variable). Line numbers are always visible — never hidden behind hover.

Type sizes match the existing cards (per design review): the skeleton uses the same `--dsw-font-*` tokens the current blocks use (the 13px/22px code-block font for segment bodies), so a unified card reads at the same size as today's `TerminalBlock`/`CodeBlock`.

### Per-segment scroll: line numbers scroll with the body, lamp is frozen

A Segment that exceeds a height cap becomes a fixed-height internal scroller. Within it, the **line numbers scroll with the body** (they belong to the content); the **lamp does not scroll** (it belongs to the Turn's status). A short IN segment is one line and never scrolls, so the lamp is naturally stationary; but a large IN (a heredoc script, a big `write` content, a big args JSON) *does* scroll, and there the lamp must be **pinned to the segment's non-scrolling shell** (anchored top-left, outside the scroller) so it stays visible while the input scrolls underneath. Long single lines overflow horizontally with a horizontal scroller; indentation is content and is never folded.

The scrollbar is a **self-drawn overlay**, not the browser's native bar: native bars are hidden (`scrollbar-width: none` + `::-webkit-scrollbar { display:none }`) and a DOM thumb is drawn in the card's design language (thin, rounded, translucent, hover-brightens). It is shown while scrolling and on segment hover, then fades ~900 ms after scrolling stops; vertical and horizontal behave identically. Positioning uses `transform` (compositor layer) and updates are `requestAnimationFrame`-throttled with reads and writes separated, so fast scrolling does not thrash layout or jitter. **Implementation note:** the shipped component should prefer a maintained overlay-scrollbar dependency (per the dependencies-over-hand-rolling policy) rather than this hand-written thumb, whose edge cases (touchpad inertia, zoom, RTL, a11y) are many; the prototype is a behaviour/style reference only.

### Per-segment controls: copy now, expand later

Each Segment carries its own control group anchored to the segment shell's top-right (the non-scrolling wrapper, so it stays put while the content scrolls) and revealed only on segment hover. Copy is **per-segment** (IN and OUT each have one) — copying the command and copying the output are separate actions; the Block has no whole-card copy button. **In the skeleton PR the group is copy-only.**

The `⤢` expand button and the fullscreen viewer it opens are **split into their own follow-up PR** (see Migration). Described here for the whole design: expand opens the segment in a **fullscreen, VSCode-style viewer** filling the whole viewport (not a centred modal overlay): a title bar showing the segment's context (tool + the IN command/path/query) plus a close control; the line-number column; row hover; and syntax highlighting. Opening locks the body scroll (`fs-lock`) so the underlying page neither scrolls nor shows its native bar; the viewer's own scroll is the same self-drawn overlay. Escape or the close control exits. When the content exceeds even the viewport, the viewer itself scrolls. **Implementation note:** highlighting should reuse the repo's existing shiki integration (as `CodeBlock` does), not a hand-rolled tokenizer.

### Empty / input-less segments collapse, symmetrically

- **Empty output** (an OUT segment with blank/invisible-only text): the command row renders with its divider, but the output row's height collapses to zero while keeping its border, so the two borders stack into a pair of adjacent divider lines — "there is an output region and it is empty" — without a blank row.
- **Input-less output** (an OUT segment with no preceding IN): the mirror image — no command row; the OUT segment carries the lamp itself. This is the shape a non-shell tool's output takes when it has no command-line input, and the shape a `generic`-fallback console dump takes.

### Six cards (and generic) as Block instances

The point is these are not new renderers but one skeleton with tool-specific IN and OUT renderers; the prototype validated ten tool shapes plus a stress suite.

| Tool | IN renders | OUT renders | Lamp |
|---|---|---|---|
| bash (1 cmd) | prompt line: cwd + command | output text (no line numbers) | exit/signal/timeout/abort |
| bash (N cmds) | one Turn per command | each command's output | per-Turn |
| bash (REPL) | one Turn per stdin round, `>>>` prompt | round output | grey mid-rounds, blue active |
| read | path + line range | numbered file lines | done/error |
| write | `path` | applied diff, real new line numbers | done/error |
| edit | `path` | applied diff, real old/new line numbers | done/error |
| grep | query + scope | match groups (line numbers) **+ recovery locator (2nd OUT)** | done/error |
| web_search | query | answer + numbered source list (clickable links) | done/error |
| web_fetch | url (link) | status line (1st OUT) **+ fetched body (2nd OUT)** | done/error |
| generic | args JSON | result text | done/error |

Source lists and fetch bodies are first-class multi-OUT-segment cases, replacing today's "a card plus an extra sibling div". Web sources render as real `http(s)`-only links (reusing `WebBlock`'s `SafeLink` safety).

### Data source: the text-reconstructable boundary is preserved

The real line between the cards is whether the structured payload can be reconstructed losslessly from the model-facing result text. bash can (`command`/`cwd` from args, exit markers parseable from output), which is why it is the one card that does **not** use `presentationMeta` today. read's line numbers, search's groupings, and web's sources are lossy in text, so they ride `presentationMeta` — the only structured channel that survives replay, since `ToolEventView` is never persisted ([api/events.ts](../../../../packages/host/apiproxy/src/api/events.ts)).

The unified abstraction does not change this boundary. Model-facing text stays the flattened, model-only encoding; the skeleton's structured segments are carried by each tool's existing `presentationMeta` (bash gains one, replacing its `parseExitStatus` text round-trip). The invariant **Model-visible ⟺ logged** ([AGENTS.md:101](../../../../AGENTS.md#L101)) is preserved: the model sees flattened text, the UI sees structured meta, both produced from the same execution.

### Extensible render kinds and custom tools — reserved, mostly deferred

`Segment.render` is an extensible tagged union of **render kinds**. The full envisioned vocabulary is `prompt` / `text` / `lines` / `diff` / `kv` / `link` / `json` / `table` / `image` / `notice`, so that a segment's payload is described by data, not by bespoke per-tool components. This is what lets custom tools reach the skeleton in three tiers:

1. **Fallback (zero code).** A tool with no presenter falls to generic: IN = args JSON, OUT = result text, rendered as ordinary segments — so it gets the lamp, copy, fullscreen, and scroll for free instead of today's threadbare `ioCard`.
2. **Declarative (`presentationMeta` returns a render-kind description, no React).** A tool describes its IN/OUT segments by picking render kinds (`kv` + `text` + `link`, say); the skeleton draws them from the shared vocabulary. Built-in tools are the same mechanism — each is just a fixed choice of kinds.
3. **Custom React renderer.** A tool that needs a shape outside the vocabulary registers its own component on the existing `conversation.chat.toolview` slot, bypassing the skeleton. This is the escape valve, not the common path.

**Scope for this PR is deliberately narrow.** Only tier 1 (fallback) and the render kinds the built-in bash/read/(one more) actually use (`prompt`/`text`/ `lines`/`diff`) ship now. The remaining kinds (`kv`/`link`/`json`/`table`/ `image`/`notice`), the declarative tier 2 as a public contract, and tier 3 wiring are **reserved in the type and deferred** — like the recursion back door, they mark where extension attaches without a data-shape change, but are not built here. The prototype validated that they compose within the skeleton (a custom `deploy` tool as `kv`+`text`+`link`; images, tables, JSON trees as OUT kinds), which is the evidence the extension point suffices — not a commitment to ship them in this PR.

Likewise the runtime state shapes the prototype exercised — streaming append (blue lamp, growing OUT), background tasks (taskId + a `notice` to poll), mid-run cancellation (amber + partial output), sandbox denial (red + `notice`), approval-required tools (a `notice` + approve/reject controls), and pure-IN side-effect Turns (an IN segment with no OUT segment at all, distinct from an empty OUT) — are real shapes the seam must not preclude, but their rendering is deferred to the PRs that add each behaviour. The first PR only keeps the types and seams from blocking them.

### Recursion is deferred (back door only)

A `Turn`/`Block` recursion — a group of commands folding into one collapsible unit with an aggregated lamp — is reserved as a typed field but **not implemented** here: no aggregation rule, no recursive renderer, no group summary. It marks where grouping would attach without another data-shape change. Building it now would require defining status aggregation across the four lamp colours, a group-title source bash does not natively provide, and a localized fold summary — none of which the motivating needs (multi-command, interactive) require.

### Migration shape

**PR 1 — skeleton + bash + one tool (validate the abstraction).** Delivered as a four-PR stack (each step bases on the one before, via the official stacked-PR mechanism), since the steps have a hard dependency order and each is one concern at ~400–700 lines:

1. **Types + presentation contract.** The shared `Block`/`Turn`/`Segment` types and the extended `ToolResultView`, with the extensible render-kind union (only `prompt`/`text`/`lines`/`diff` implemented). Pure types; unit tests only — no assembled-transcript snapshot yet, since no tool produces one until 1c.
2. **Skeleton component** in `ui-primitives` (the `CardShell` the six cards anticipated): the one lamp derivation, adaptive gutter, per-segment scroll + overlay scrollbar, per-segment copy (control group **copy-only**). Component unit + render snapshots.
3. **bash** converted, including interactive/multi-command Turns and a new bash `presentationMeta` carrying structured rounds. First real tool — the snapshot/e2e coverage that needs real tool data lands here.
4. **One more tool** (read or search) converted, proving the abstraction is genuinely tool-neutral, not bash-shaped, before batch migration; its own snapshot/e2e.

Snapshot and e2e coverage is concentrated in 1c/1d (the first PRs with a real tool producing an assembled transcript); 1a/1b carry the tests they can (types, component units) rather than forcing an assembled-transcript snapshot before a tool exists.

**PR 2 — migrate the remaining tools (higher priority than fullscreen).** Once the abstraction is validated, convert every remaining tool (write/edit, grep/glob, web_search/web_fetch, and the generic fallback) to the skeleton; collapse the six-arm wire→props dispatch in `ToolRow`/`DetailsPanel`; retire the now-unused per-block `.block` geometry, the six `*-card-model`s, and the duplicated cap/copy code; unify the `CHAT_*` constants; fold i18n into one labels surface. This carries the product value (all cards on one consistent skeleton), so it precedes the fullscreen enhancement. A single ~8–10k-line PR would be unreviewable and concentrate risk, so PR 2 is delivered as a stack of smaller per-tool-group PRs (e.g. write/edit; grep/glob; web) using the repo's official stacked-PR mechanism, each ~500–800 lines.

**PR 3 — fullscreen viewer.** The VSCode-style fullscreen viewer *and* the `⤢` expand button that opens it are a separate, lower-priority enhancement in their own PR depending on the skeleton PR. It reuses the skeleton's Segment rendering (title bar from the Turn's IN context, the line-number column, the overlay scrollbar) inside a full-viewport container, locks the body, and adds syntax highlighting via the repo's shiki integration. The skeleton PR does not render or reference it; the expand button appears only in this PR.

**Later** — the deferred extension points (declarative render-kind tier 2, the non-file render kinds `kv`/`link`/`json`/`table`/`image`/`notice`, tier-3 custom renderers, `Turn`/`Block` recursion, and the per-behaviour status shapes) land as their own PRs when the behaviour they serve is built.

This note's owning work is PR 1, itself a four-PR stack (1a–1d); PR 2 (full migration, a stack of per-tool-group PRs) precedes PR 3 (fullscreen).

## Alternatives considered

- **Extend only bash to multi-command, leave the other five cards alone.** Rejected: interactive bash needs List-of-Blocks anyway, and the "input is a title string", "status lives outside the card", and "OUT is already two things" patterns are shared across tools, not bash-specific.

- **Flat segment stream (no Turn container).** `List = Segment[]`, IN/OUT interleaved, lamp on IN segments. Rejected: it deletes "which segments belong to one execution" from the data, forcing the renderer to infer grouping from "next IN starts a new unit". Interactive sessions (one process, many stdin rounds) then cannot be distinguished from independent commands.

- **One lamp per whole call (status stays in row chrome).** Rejected: a batch of commands and an interactive session both need per-round outcome, which a single call-level lamp cannot express. The lamp attaches at the Turn level.

- **Keep shell vocabulary and special-case other tools.** Rejected: the abstraction exists to carry non-shell inputs; shell field names would force every other tool through a translation shim.

- **Lamp and line-number in separate frozen/scrolling columns.** Rejected as over-built: since the lamp is on the IN segment and line numbers on the OUT segment, one shared gutter column with mutually-exclusive content is sufficient, and IN segments rarely scroll so the lamp is naturally frozen.

- **Expand as a centred modal / "show N more" button.** Rejected in favour of a full-viewport VSCode-style viewer (for long content) plus per-segment scroll (for quick scanning); the two together cover both reading modes.

- **Native scrollbars styled via `::-webkit-scrollbar`.** Rejected: webkit-only, absent in headless/other engines, occupies width, and cannot match the card design consistently. A self-drawn overlay is engine-independent — though the shipped version should use a maintained dependency, not the prototype's thumb.

- **Build recursion now.** Deferred, not rejected: kept as a typed back door so the eventual grouping feature needs no second data-shape migration.

## Acceptance criteria

- A single `Block`/`Turn`/`Segment` type set and skeleton component exist in `ui-primitives`; bash and one other tool render through it; the four current status derivations are replaced by the one lamp function for those two tools.
- bash carries structured rounds via `presentationMeta`; its `parseExitStatus` text round-trip is gone; the model-facing bash text is unchanged (snapshot).
- Multi-command and interactive (multi-round) bash render as multiple Turns/Segments with per-Turn lamps; the single-command case is visually equivalent to today's `TerminalBlock` (snapshot).
- One gutter width per Block aligns every Turn's body line; line numbers are always visible; empty-output and input-less segments collapse per the rules.
- Per-segment IN/OUT copy works (the group is copy-only in this PR; the expand button and fullscreen viewer are a separate PR); `Turn`/`Block` recursion is present in the type and unused at runtime.
- The full six-category test matrix ships in the same PR (unit per-file 100%, e2e, snapshot, smoke, CI gates, sandbox), including a keyless snapshot through a real runnable example asserting the assembled transcript.

## Risks

- **Scope.** This touches the presentation contract ([presentation.ts](../../../../packages/core/tools/src/presentation.ts)), the card-model derivation layer, `ui-primitives`, and the host→client view flow. It is staged (bash + one tool now) to bound the first PR while proving generality.
- **Wire is untrusted.** `sessions.schema.ts` validates only `for` + `card: string`; every existing card-model re-narrows defensively. The unified wire→props layer MUST keep per-tool narrowing or a malformed payload crashes a row or the details panel.
- **Replay purity.** Presenters run on the live and replay paths and must stay pure functions of args (+result meta), no I/O, clock, or session state ([adding-a-tool.md](../../../../docs/cookbook/adding-a-tool.md)). The lamp derivation and segment builders must respect this.
- **Hand-rolled UI mechanics.** The prototype hand-draws the overlay scrollbar and hand-tokenizes highlighting; the shipped component must instead reuse a maintained scrollbar dependency and the repo's shiki integration, or it reintroduces the very edge-case burden this note warns about.
- **What is given up.** Uniform status means the five cards that today show *no* in-card status gain a lamp; for genuinely unobservable outcomes the honest value is grey — the abstraction must not manufacture a green "success" for something it cannot observe (the same "observable or omit" discipline the lamp and gutter both follow).
- **AGENTS.md drift.** [AGENTS.md:117](../../../../AGENTS.md#L117) still lists three card kinds; the render-intent union already has six. This work should update that line and the render-intent design note in the same PR.
