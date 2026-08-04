# Agent Note: Unified List-of-Blocks tool render

Status: proposed

English | [中文](2026-08-03-unified-list-of-blocks-tool-render.zh.md)

## Problem

Every tool result card in the web UI is a bespoke primitive with its own data shape, its own CSS geometry, and its own place in a hand-maintained dispatch chain. There are five tool-result cards — `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, `WebBlock` — plus the generic fallback row and the shared code surface `CodeBlock`, and they agree on nothing structural:

- **Status lives in six-plus places.** Only `TerminalBlock` carries a run-state indicator *inside* the card (a single `StateDot` for the whole call, on the first prompt row only, at [TerminalBlock.tsx:240](../../../../packages/client/ui-primitives/src/TerminalBlock.tsx#L240), plus an exit-code/signal `Pill`). The other four cards carry none; their success, failure, and stopped states are painted by the surrounding row chrome. The derivations do not share a source: `ToolRowState` ([tool-call-model.ts:23](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L23)), `terminalFailed` ([terminal-card-model.ts:71](../../../../packages/client/ui-conversation/src/client/contract/terminal-card-model.ts#L71), needed because a failing bash command settles with `isError: false`), `StateDotState`'s four values, and `TerminalBlock`'s own internal running/exit/signal mapping are four independent encodings of the same idea.

- **"Input" has no shared representation.** Only `terminal` (command/cwd/description) and `diff` (`FileDiff[]`) declare a structured call view. `read`, `grep`, `glob`, `web_search`, `web_fetch` collapse their entire multi-field input into a single English `title` string plus a `rawInput` string; grep's `path`/`include` survive only as substrings of `"Grep X in Y (Z)"`. The only place an actual IN/OUT segment pair is rendered today is the generic fallback `div.ioCard` ([ToolRow.tsx:294](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L294)), which is hardcoded inside `ToolRow`, supports exactly two segments, and cannot nest or be reused.

- **Structure is duplicated by convention, not shared by code.** There is no `CardShell` (`grep -rn CardShell` = 0). Five CSS modules each declare a `.block` root repeating the same four properties and each defining its own `--dsl-<name>-radius: 12px` and a `--dsl-<name>-line-height: 22px` (`WebBlock` declares only the radius; its line-heights are raw values). `headTailCap` and `useCopyFeedback` each have exactly two callers; `ReadBlock` and `DiffBlock` inline the identical head/tail arithmetic and the identical 1000 ms copy timeout with hardcoded Chinese literals (`WebBlock` does neither — it draws every source the tool already cut). Three `CHAT_*_MAX_LINES = 8` constants repeat the same "half the primitive's own default" comment, while the `CHAT_TERMINAL_MAX_LINES` two comments reference does not exist — the terminal row passes `maxLines={Infinity}`. The wire→props dispatch is a multi-arm chain written once as a nested ternary in [ToolRow.tsx:258](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L258) and again — in a different order — as an if/return chain in [DetailsPanel.tsx:150](../../../../packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx#L150).

- **i18n is asymmetric.** Only `TerminalBlock` has a full `TerminalBlockLabels` surface; the other four cards inline Chinese literals — [ui-primitives/README.md](../../../../packages/client/ui-primitives/README.md) records the gap for `WebBlock` alone, the other three being unrecorded.

The precipitating need is interactive, multi-command bash: a single bash call will run several commands, and a persistent/interactive session (a REPL, a PTY) will exchange stdin/stdout in multiple rounds. Neither fits `TerminalBlock`'s flat "one card, one command banner, one output box, one status" shape. Extending only bash would add a sixth bespoke variant. The same List-of-Blocks structure that interactive bash needs is the structure that unifies all five cards, so the foundation is worth laying once for all of them rather than bolting a bespoke multi-command mode onto bash alone.

## Proposal

Introduce one shared render skeleton with a three-level structure, and express all five existing cards — plus interactive/multi-command bash — as instances of it. The skeleton owns everything common (layout, the status lamp, the alignment gutter, per-segment scroll, copy, and the expand hook into the side preview panel); each tool supplies only how its own input and output render.

An interactive prototype validating this design (all tool shapes, the stress cases, and the blind-spot render kinds) lives on the orphan assets branch, not in the tree: [`unified-list-of-blocks-mock.html`](https://github.com/deepseek-harness/deepseek-harness/blob/list-of-blocks-assets/unified-list-of-blocks-mock.html). It is a one-time design artifact — the note text, not the prototype, is the authority for what ships.

### The three levels: Block / Turn / Segment

```
Block    — one tool call's whole card
 └─ Turn  — one IN/OUT pair + one lamp — bash: one per command; REPL: one per round
     ├─ Segment (IN)  — this operation's input representation
     └─ Segment (OUT) — its output; a tool may emit more than one (grep: matches
                        + recovery locator; web_fetch: status line + body)
```

`Block` is *not* a list; it is the card object that holds a list of `Turn`s; each `Turn` holds its `Segment`s. The outer List-of-Blocks in the UI is one `Block` per tool call. The name is deliberately a different layer from the `*Block` primitive family it replaces (`TerminalBlock` et al. are leaf renderers; `Block` is a data container the skeleton draws) — and `Turn` here is one command or one stdin round of a card, distinct from the session model's `Turn` (one assistant loop iteration, `turn/start`/`turn/end`).

Vocabulary is deliberately tool-neutral: the field names are **not** shell words (`command`/`cwd`/`exitCode`), because the same skeleton must carry a file read, a diff, a search query, and a fetched URL. Each tool provides a renderer for its own IN payload and OUT payload; the skeleton knows only `Segment`, `role: 'in' | 'out'`, an optional `lamp`, and the tool-supplied render.

### The lamp: one observational derivation

Today's four status derivations collapse into one function over what the harness can observe, attached at the `Turn` level (rendered in the IN segment's gutter):

- **`isError === false` → green (done).** Operation completed without error — that completion is itself the observable signal. This is the base rule for *every* tool: a read, a write, a search that simply succeeded is green. There is no manufactured "success" beyond "it finished and did not error".
- **error → red.** The tool reported `isError`.
- **running → blue** (the `ongoing` pixel-chase dot).
- **bash refines further** because it has an exit code the other tools lack: `timedOut`/`aborted` → **amber (warn)** (the harness terminated it on a limit or cancellation — the command had no choice); a terminating `signal` not from our timeout/abort → **red** (crash `SIGSEGV`, or an external `SIGTERM`; a `SIGTERM` we sent for a timeout is already caught by the amber rule, so any signal reaching here is externally sourced); else the exit code decides.
- **grey (neutral)** only where an outcome is genuinely unobservable — a REPL turn (`>>> 2+2`) has no shell exit code, and a non-final command inside a single multi-command call (`echo a; false; echo b`) yields no per-command status: the harness observes one exit code per call, and a single call running several commands with per-command status is not a current capability anywhere. Both are grey. The skeleton never parses a Traceback to invent a red lamp for an outcome it cannot observe. Per-Turn lamps therefore appear where the harness observes the turn's own outcome — a single-command call, or one round of an interactive session; capturing per-command status (an executor change) is a deferred capability, reserved in the type, that would upgrade a multi-command call's intermediate turns from grey.

`warn` (amber) is the one new state relative to the current three-state `StateDot` use; the token already exists ([StateDot.module.css](../../../../packages/client/ui-primitives/src/StateDot.module.css)). Signal attribution uses only the harness's own signals, never a guess at who sent a signal, because the OS does not report the sender. The two amber inputs split by channel: an aborted call settles with `error.code: 'interrupted'` on the persisted result node, which the client lamp derivation reads directly (the same source the row's `stopped` state uses today — replayable without any meta); `timedOut` lives in the bash result value, which a presenter never sees (`presentationMeta` runs on the success path only), so it must ride the new bash `presentationMeta` for the lamp to survive replay.

Like today's `StateDot`, the lamp is colour-only and `aria-hidden`; each lamp carries a matching accessible status text (the row's `stateStatus` pattern), so done/error/running/warn survive without colour for colour-blind and screen-reader users.

### No verb label inside the card

A segment's IN renders the tool's real input (bash: the prompt line; read: path + line range; write/edit: path; grep: query + scope; web: query/url; generic: args JSON). It carries **no** `READ`/`WRITE`/`GREP` verb badge — the enclosing tool row already shows the tool's icon and title, so repeating it inside the card is redundant.

### The alignment gutter: lamp and line-number share one column, mutually exclusive

Every Segment is a two-column grid `[gutter][body]`. The gutter's content is **mutually exclusive by role**:

- IN segment → the **lamp** (left-aligned, pinned to the far left). An IN segment **never carries line numbers**, even when it is many lines (a heredoc running a whole script, a large `write` content, a big args JSON): its lines are the operation's input, not file content, so they have no "line N". Only the lamp occupies its first-row gutter; every other IN row's gutter is empty.
- OUT segment → **line numbers** (right-aligned, hugging the body line), only for the OUTs that show *file content*: read (file line numbers), grep (matched file line numbers), diff (actual old/new line numbers — the gutter shows real line numbers, **not** `+`/`-` marks; red deletes / green adds colour the number and the body; a deleted line and its replacement can both show the same number, and that side-by-side repeat is accepted rather than introducing a two-column old/new gutter). Real line numbers require the diff payload to carry them: today's `FileDiff` holds only `path`/`oldText`/`newText` and the hunk computation drops `oldStart`/`newStart`, so the diff render kind extends that payload with old/new start lines as part of the presentation contract (PR 1a types). Non-file OUTs (bash output, web body, args JSON, a custom tool's text) have no line numbers and leave the gutter empty.

Because the lamp lives on the IN segment and line numbers on the OUT segment, "one column, mutually exclusive" holds naturally — a given segment's gutter has only one kind of content.

**One gutter width per Block, computed to align every Turn.** The gutter column width is `max(lamp-min, widest line number in this Block)`; all IN and OUT segments in the card share it, so IN commands, OUT text, and numbered rows all start on the same body line. The width is adaptive (a 6-digit line number widens the gutter and shifts the body line; the lamp stays pinned far-left). In the prototype this is measured in JS; the shipped component computes it the same way (measure widest gutter content, set a CSS variable). Line numbers are always visible — never hidden behind hover.

Type sizes match the existing cards (per design review): the skeleton uses the same `--dsw-font-*` tokens the current blocks use (the 13px/22px code-block font for segment bodies), so a unified card reads at the same size as today's `TerminalBlock`/`CodeBlock`.

### Per-segment scroll: line numbers scroll with the body, lamp is frozen

A Segment that exceeds a height cap becomes a fixed-height internal scroller. Within it, the **line numbers scroll with the body** (they belong to the content); the **lamp does not scroll** (it belongs to the Turn's status). A short IN segment is one line and never scrolls, so the lamp is naturally stationary; but a large IN (a heredoc script, a big `write` content, a big args JSON) *does* scroll, and there the lamp must be **pinned to the segment's non-scrolling shell** (anchored top-left, outside the scroller) so it stays visible while the input scrolls underneath. Long single lines overflow horizontally with a horizontal scroller; indentation is content and is never folded.

The scrollbar is a **self-drawn overlay**, not the browser's native bar: native bars are hidden (`scrollbar-width: none` + `::-webkit-scrollbar { display:none }`) and a DOM thumb is drawn in the card's design language (thin, rounded, translucent, hover-brightens). It is shown while scrolling and on segment hover, then fades ~900 ms after scrolling stops; vertical and horizontal behave identically. Positioning uses `transform` (compositor layer) and updates are `requestAnimationFrame`-throttled with reads and writes separated, so fast scrolling does not thrash layout or jitter. **Implementation note:** the shipped component should prefer a maintained overlay-scrollbar dependency (per the [dependencies-over-hand-rolling policy](../../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)) rather than this hand-written thumb, whose edge cases (touchpad inertia, zoom, RTL, a11y) are many; the prototype is a behaviour/style reference only.

### Per-segment controls: copy now, expand later

Each Segment carries its own control group anchored to the segment shell's top-right (the non-scrolling wrapper, so it stays put while the content scrolls) and revealed on segment hover, keyboard focus (`:focus-within`), and touch, with every control itself keyboard- and touch-operable. Copy is **per-segment** (IN and OUT each have one) — copying the command and copying the output are separate actions; the Block has no whole-card copy button. **In the skeleton PR the group is copy-only.**

The `⤢` expand button and the preview panel it opens are **split into their own follow-up PR** (see Migration). Described here for the whole design: expand opens the segment in a **resizable side preview panel** docked to the right of the conversation, not a fullscreen takeover. The panel is a general-purpose preview container — it renders the segment's content (a bash segment today; a code preview or other kinds later) with the same Segment rendering the inline card uses (the tool/IN context as a header, the line-number column, the overlay scrollbar). Its width is drag-adjustable via a divider handle. The panel is a **singleton**: clicking a different segment's `⤢` while the panel is open **replaces** its content in place rather than stacking or opening a second panel. The panel can itself **expand one further level to true fullscreen** (fullscreen becomes a second-level action of the panel, not the primary one); at that level the underlying page is scroll-locked and the panel's own scroll is the same self-drawn overlay. Escape or a close control collapses back one level (fullscreen → panel → closed). This is the evolution of today's right-side `DetailsPanel` Output pane into a draggable, click-to-replace, general container. **Implementation note:** any code/syntax rendering reuses the repo's existing shiki integration (as `CodeBlock` does), not a hand-rolled tokenizer.

### Empty / input-less segments collapse, symmetrically

- **Empty output** (an OUT segment with blank/invisible-only text): the command row renders with its divider, but the output row's height collapses to zero while keeping its border, so the two borders stack into a pair of adjacent divider lines — "there is an output region and it is empty" — without a blank row.
- **Input-less output** (an OUT segment with no preceding IN): the mirror image — no command row; the OUT segment carries the lamp itself. This is the shape a non-shell tool's output takes when it has no command-line input, and the shape a `generic`-fallback console dump takes.

### Five cards (and generic) as Block instances

The point is these are not new renderers but one skeleton with tool-specific IN and OUT renderers; the prototype validated ten tool shapes plus a stress suite.

| Tool | IN renders | OUT renders | Lamp |
|---|---|---|---|
| bash (1 cmd) | prompt line: cwd + command | output text (no line numbers) | exit/signal/timeout/abort |
| bash (N cmds) | one Turn per command | each command's output | per-Turn where the harness observes each command's status; grey otherwise |
| bash (REPL) | one Turn per stdin round, `>>>` prompt | round output | grey mid-rounds, blue active |
| read | path + line range | numbered file lines | done/error |
| write | `path` | applied diff, real new line numbers | done/error |
| edit | `path` | applied diff, real old/new line numbers | done/error |
| grep | query + scope | match groups (line numbers) **+ recovery locator (2nd OUT)** | done/error |
| web_search | query | answer + numbered source list (clickable links) | done/error |
| web_fetch | url (link) | status line (1st OUT) **+ fetched body (2nd OUT)** | done/error |
| generic | args JSON | result text | done/error |

Source lists and fetch bodies are first-class multi-OUT-segment cases, replacing today's "a card plus an extra sibling div". Web sources render as real `http(s)`-only links (reusing `WebBlock`'s `SafeLink` safety).

Two presentational shapes survive into the skeleton explicitly. write/edit keep the running-state call-time diff — the intended change renders as the OUT segment while the call is in flight, replaced by the applied result diff at settle (today's `diffCardModel` behaviour) — so the pending diff is not lost to a result-only table. And the code variant's program body (`run_code`, `cordis_mount`), today a `CodeBlock` with shiki, renders as a `lines` segment (numbered, with `lang` driving the same shiki integration), so the code presentation survives the migration.

### Data source: the text-reconstructable boundary is preserved

The real line between the cards is whether the structured payload can be reconstructed losslessly from the model-facing result text. bash can (`command`/`cwd` from args, exit markers parseable from output), which is why it is the one card that does **not** use `presentationMeta` today. read's line numbers, search's groupings, and web's sources are lossy in text, so they ride `presentationMeta` — the only structured channel that survives replay, since `ToolEventView` is never persisted ([api/events.ts](../../../../packages/host/apiproxy/src/api/events.ts)).

The unified abstraction does not change this boundary. Model-facing text stays the flattened, model-only encoding; the skeleton's structured segments are carried by each tool's existing `presentationMeta` (bash gains one, replacing its `parseExitStatus` text round-trip). The invariant **Model-visible ⟺ logged** ([AGENTS.md:100](../../../../AGENTS.md#L100)) is preserved: the model sees flattened text, the UI sees structured meta, both produced from the same execution.

### Extensible render kinds and custom tools — reserved, mostly deferred

`Segment.render` is an extensible tagged union of **render kinds**. The full envisioned vocabulary is `prompt` / `text` / `lines` / `diff` / `kv` / `link` / `json` / `table` / `image` / `notice`, so that a segment's payload is described by data, not by bespoke per-tool components. This is what lets custom tools reach the skeleton in three tiers:

1. **Fallback (zero code).** A tool with no presenter falls to generic: IN = args JSON, OUT = result text, rendered as ordinary segments — so it gets the lamp, copy, scroll, and (once PR 3 lands) the preview panel for free instead of today's threadbare `ioCard`.
2. **Declarative (`presentationMeta` returns a render-kind description, no React).** A tool describes its IN/OUT segments by picking render kinds (`kv` + `text` + `link`, say); the skeleton draws them from the shared vocabulary. Built-in tools are the same mechanism — each is just a fixed choice of kinds.
3. **Custom React renderer.** A tool that needs a shape outside the vocabulary registers its own component on the existing `conversation.chat.toolview` slot, bypassing the skeleton. This is the escape valve for out-of-vocabulary shapes — and today's *main* path for the built-in rows (`bash`/`read`/`search`/`web`/`write`/`edit`/`ask_user_question`/`todo_write` already register per-tool components on this slot, with `GenericToolCard` as the fallback), which the skeleton PRs migrate onto the shared render kinds.

**Scope for PR 1 is deliberately narrow.** Only tier 1 (the skeleton's generic fallback: IN = args JSON, OUT = result text as ordinary segments) and the render kinds bash plus one more tool (read or search, per 1d) actually use (`prompt`/`text`/`lines`/`diff`) ship now; PR 2 retires the old `ioCard`/flattened-text fallback arms in `ToolRow`/`DetailsPanel`. The remaining kinds (`kv`/`link`/`json`/`table`/`image`/`notice`), the declarative tier 2 as a public contract, and tier 3 wiring are **deferred — and not pre-declared in the type**: the render-kind union follows the render-intent union's closed-union discipline ([the render-intent-union note](../../implemented/architecture/2026-07-02-tool-render-intent-union.md) rejects merge-extensible unions, because a variant the consumer silently drops is worse than the compile error a closed union raises at its switch). Each kind ships with its renderer, and adding one is a compile-breaking change at the skeleton's kind switch. What IS designed now is the extension point — the union plus the skeleton's kind switch — so a kind can be added without a data-shape change; the card-level `ToolResultView` union stays closed per that note, and a payload that matches no known kind degrades to explicit `text`, never silence. The prototype validated that the deferred kinds compose within the skeleton (a custom `deploy` tool as `kv`+`text`+`link`; images, tables, JSON trees as OUT kinds), which is the evidence the extension point suffices — not a commitment to ship them in this PR.

Likewise the runtime state shapes the prototype exercised — streaming append (blue lamp, growing OUT), background tasks (taskId + a `notice` to poll), mid-run cancellation (amber + partial output), sandbox denial (red + `notice`), approval-required tools (a `notice` + approve/reject controls), and pure-IN side-effect Turns (an IN segment with no OUT segment at all, distinct from an empty OUT) — are real shapes the seam must not preclude, but their rendering is deferred to the PRs that add each behaviour. The first PR only keeps the types and seams from blocking them.

### Recursion is deferred (back door only)

A `Turn`/`Block` recursion — a group of commands folding into one collapsible unit with an aggregated lamp — is **deferred entirely, with no field in the type**: no aggregation rule, no recursive renderer, no group summary. A pre-declared recursion field with no consumer would let a producer construct type-valid values the client silently ignores — the same failure the closed-union rule rejects — so grouping, when built, lands as a compile-breaking type extension alongside its renderer (no second data-shape migration is claimed). Building it now would require defining status aggregation across the four lamp colours, a group-title source bash does not natively provide, and a localized fold summary — none of which the motivating needs (multi-command, interactive) require.

### Migration shape

**PR 1 — skeleton + bash + one tool (validate the abstraction).** Delivered as a four-PR stack (each step bases on the one before, via the official stacked-PR mechanism), since the steps have a hard dependency order and each is one concern at ~400–700 lines:

1. **Types + presentation contract.** The shared `Block`/`Turn`/`Segment` types and the extended `ToolResultView`, with the extensible render-kind union (only `prompt`/`text`/`lines`/`diff` implemented). Pure types; unit tests only — no assembled-transcript snapshot yet, since no tool produces one until 1c.
2. **Skeleton component** in `ui-primitives` (the `CardShell` the five cards anticipated): the one lamp derivation, adaptive gutter, per-segment scroll + overlay scrollbar, per-segment copy (control group **copy-only**). Component unit + render snapshots.
3. **bash** converted, including interactive/multi-command Turns and a new bash `presentationMeta` carrying structured rounds. First real tool — the snapshot/e2e coverage that needs real tool data lands here.
4. **One more tool** (read or search) converted, proving the abstraction is genuinely tool-neutral, not bash-shaped, before batch migration; its own snapshot/e2e.

Snapshot and e2e coverage is concentrated in 1c/1d (the first PRs with a real tool producing an assembled transcript); 1a/1b carry the tests they can (types, component units) rather than forcing an assembled-transcript snapshot before a tool exists.

**PR 2 — migrate the remaining tools (higher priority than the preview panel).** Once the abstraction is validated, convert every remaining tool (write/edit, grep/glob, web_search/web_fetch) to the skeleton (the generic fallback path already ships with the skeleton in PR 1 — PR 2 retires the old `ioCard`/flattened-text fallback arms in `ToolRow`/`DetailsPanel`); collapse the six-arm wire→props dispatch in `ToolRow`/`DetailsPanel`; retire the now-unused per-block `.block` geometry, the five `*-card-model`s, and the duplicated cap/copy code; unify the `CHAT_*` constants; fold i18n into one labels surface. This carries the product value (all cards on one consistent skeleton), so it precedes the preview-panel enhancement. A single ~8–10k-line PR would be unreviewable and concentrate risk, so PR 2 is delivered as a stack of smaller per-tool-group PRs (e.g. write/edit; grep/glob; web) using the repo's official stacked-PR mechanism, each ~500–800 lines.

**PR 3 — side preview panel.** The resizable side preview panel *and* the `⤢` expand button that opens it are a separate, lower-priority enhancement in their own PR depending on the skeleton PR. It reuses the skeleton's Segment rendering inside a right-docked, drag-resizable, singleton container (click-to-replace), evolving today's `DetailsPanel` Output pane; a second-level expand takes the panel to true fullscreen (scroll-locked, overlay scrollbar). The skeleton PR does not render or reference it; the expand button appears only in this PR.

**Later** — the deferred extension points (declarative render-kind tier 2, the non-file render kinds `kv`/`link`/`json`/`table`/`image`/`notice`, tier-3 custom renderers, `Turn`/`Block` recursion, and the per-behaviour status shapes) land as their own PRs when the behaviour they serve is built.

This note's owning work is PR 1, itself a four-PR stack (1a–1d); PR 2 (full migration, a stack of per-tool-group PRs) precedes PR 3 (side preview panel).

## Alternatives considered

- **Extend only bash to multi-command, leave the other four cards alone.** Rejected: interactive bash needs List-of-Blocks anyway, and the "input is a title string", "status lives outside the card", and "OUT is already two things" patterns are shared across tools, not bash-specific.

- **Flat segment stream (no Turn container).** `List = Segment[]`, IN/OUT interleaved, lamp on IN segments. Rejected: it deletes "which segments belong to one execution" from the data, forcing the renderer to infer grouping from "next IN starts a new unit". Interactive sessions (one process, many stdin rounds) then cannot be distinguished from independent commands.

- **One lamp per whole call (status stays in row chrome).** Rejected: a batch of commands and an interactive session both need per-round outcome, which a single call-level lamp cannot express. The lamp attaches at the Turn level.

- **Keep shell vocabulary and special-case other tools.** Rejected: the abstraction exists to carry non-shell inputs; shell field names would force every other tool through a translation shim.

- **Lamp and line-number in separate frozen/scrolling columns.** Rejected as over-built: since the lamp is on the IN segment and line numbers on the OUT segment, one shared gutter column with mutually-exclusive content is sufficient, and IN segments rarely scroll so the lamp is naturally frozen.

- **Expand as a centred modal / fullscreen takeover / "show N more" button.** Rejected in favour of a resizable right-docked side preview panel (singleton, click-to-replace, general-purpose, with an optional second-level expand to true fullscreen) plus per-segment scroll (for quick scanning); the panel keeps the conversation visible while previewing, generalises to code preview and other kinds, and reuses the existing `DetailsPanel` placement rather than a full-viewport takeover as the primary action.

- **Native scrollbars styled via `::-webkit-scrollbar`.** Rejected: webkit-only, absent in headless/other engines, occupies width, and cannot match the card design consistently. A self-drawn overlay is engine-independent — though the shipped version should use a maintained dependency, not the prototype's thumb.

- **Build recursion now.** Deferred, not rejected: grouping, when built, lands as a compile-breaking type extension alongside its renderer — no back-door field is pre-declared, per the closed-union discipline.

## Acceptance criteria

- A single `Block`/`Turn`/`Segment` type set exists in the presentation contract (`core/tools/src/presentation.ts`, beside `ToolResultView`, where tools type their `presentationMeta` projections against it — never in `ui-primitives`, which the host side cannot import) and the skeleton component exists in `ui-primitives`; bash and one other tool render through it; the four current status derivations are replaced by the one lamp function for those two tools.
- bash carries structured rounds via `presentationMeta`; its `parseExitStatus` text round-trip is gone; the model-facing bash text is unchanged (snapshot).
- Multi-command and interactive (multi-round) bash render as multiple Turns/Segments, with per-Turn lamps where the harness observes each turn's outcome and grey where it does not; the single-command case is visually equivalent to today's `TerminalBlock` (snapshot).
- One gutter width per Block aligns every Turn's body line; line numbers are always visible; empty-output and input-less segments collapse per the rules.
- Per-segment IN/OUT copy works (the group is copy-only in this PR; the expand button and side preview panel are a separate PR); no `Turn`/`Block` recursion field exists in the type (deferred with its renderer).
- The full test matrix ships in PR 1 as a whole (unit per-file 100%, real-API e2e, keyless snapshot, web browser snapshot where the surface applies, smoke, CI gates, sandbox), including a keyless snapshot through a real runnable example asserting the assembled transcript. Coverage concentrates in 1c/1d (the first PRs with a real tool producing a transcript); 1a/1b carry the tests they can, per the Migration section.

## Risks

- **Scope.** This touches the presentation contract ([presentation.ts](../../../../packages/core/tools/src/presentation.ts)), the card-model derivation layer, `ui-primitives`, and the host→client view flow. It is staged (bash + one tool now) to bound the first PR while proving generality.
- **Wire is untrusted.** `sessions.schema.ts` validates only `for` + `card: string`; every existing card-model re-narrows defensively. The unified wire→props layer MUST keep per-tool narrowing or a malformed payload crashes a row or the details panel.
- **Replay purity.** Presenters run on the live and replay paths and must stay pure functions of args (+result meta), no I/O, clock, or session state ([adding-a-tool.md](../../../../docs/cookbook/adding-a-tool.md)). The lamp derivation and segment builders must respect this.
- **Hand-rolled UI mechanics.** The prototype hand-draws the overlay scrollbar and hand-tokenizes highlighting; the shipped component must instead reuse a maintained scrollbar dependency (per the [dependencies-over-hand-rolling policy](../../../../.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)) and the repo's shiki integration, or it reintroduces the very edge-case burden this note warns about.
- **What is given up.** Uniform status means the five cards that today show *no* in-card status gain a lamp; for genuinely unobservable outcomes the honest value is grey — the abstraction must not manufacture a green "success" for something it cannot observe (the same "observable or omit" discipline the lamp and gutter both follow).
- **AGENTS.md drift.** [AGENTS.md:116](../../../../AGENTS.md#L116) still lists three card kinds; the render-intent union already has six. This work should update that line and the render-intent design note in the same PR.

## Supersedes

This proposal replaces the bespoke card renderers and their derivation layer, so it amends the Agent Notes that own those decisions. Partial, not full: the presentation contract, the wire vocabulary, and the generic fallback survive. The notes whose decisions this work supersedes are the render-intent union ([2026-07-02-tool-render-intent-union.md](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)) and the per-card records ([2026-07-28-web-terminal-card.md](../../implemented/feature/2026-07-28-web-terminal-card.md), [2026-07-30-web-read-card.md](../../implemented/feature/2026-07-30-web-read-card.md), [2026-07-30-web-read-card-frontend.md](../../implemented/feature/2026-07-30-web-read-card-frontend.md), [2026-07-30-web-search-card.md](../../implemented/feature/2026-07-30-web-search-card.md), [2026-07-30-web-diff-card.md](../../implemented/feature/2026-07-30-web-diff-card.md), [2026-07-30-search-render-card.md](../../implemented/feature/2026-07-30-search-render-card.md), [2026-07-30-web-result-card.md](../../implemented/feature/2026-07-30-web-result-card.md), [2026-07-30-web-result-card-frontend.md](../../implemented/feature/2026-07-30-web-result-card-frontend.md), [2026-07-31-web-cards-toolrow.md](../../implemented/feature/2026-07-31-web-cards-toolrow.md)). Each is updated where this work lands (PR 2) rather than consolidated, per the notes policy on partial supersession.
