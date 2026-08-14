# tool-owned-render

A design note and interactive prototype for making tool result rendering in an agent chat UI **tool-owned**: each tool self-registers its own React component on a keyed render slot and composes shared layout primitives, instead of a central skeleton owning a render-kind union.

## The design

Two principles decide the model:

- A tool's presentation must be changeable in isolation.
- A tool author keeps the right to restructure their own presentation.

A central skeleton with a shared render-kind switch fails both. So there is no central render dispatch and no render-kind union. Instead there are three layout primitives:

- **ToolCard** — the card frame.
- **Segment** — the core IN/OUT unit.
- **Group** — optional; bundles Segments under one status lamp, for multi-execution tools.

Plus one observational status derivation offered as a helper (rather than imposed), and two paths for a tool author: write your own React, or get a generic zero-code fallback.

## Read the note

- [English](docs/tool-owned-render.md)
- [中文](docs/tool-owned-render.zh.md)

The note covers the primitives, the lamp derivation, the two paths, the text-reconstructable data boundary, deferred extension points, alternatives considered, and a staged migration plan.

## Prototype

[`prototype/unified-list-of-blocks-mock.html`](prototype/unified-list-of-blocks-mock.html) is a standalone interactive prototype — open it directly in a browser, no build step. It covers all tool shapes, Group cases, stress cases, and both authoring paths.

Tool-owned render, dark and light:

![tool-owned render, dark](screenshots/01-toolcard-dark.png)

![tool-owned render, light](screenshots/02-toolcard-light.png)

The two paths — a tool composing its own React, versus the generic zero-code fallback:

![two paths](screenshots/03-two-paths.png)

## Status

Proposed. This is a design document, not an implementation.

## Context

This note was written against a private codebase, and its arguments cite that codebase's file paths and line numbers as evidence. Those references are preserved verbatim because they are load-bearing to the reasoning, but they will not resolve from this repository. The design itself is independent of them.
