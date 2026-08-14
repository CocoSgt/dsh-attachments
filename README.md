# dsh-attachments

[简体中文](README.zh-CN.md) | English

npm package: `dsh-attachments` · GitHub repository:
[CocoSgt/dsh-attachments](https://github.com/CocoSgt/dsh-attachments)

A third-party attachment plugin for DeepSeek Harness (dsh): **bring any file into the conversation, zero type rejection**.

- **Every file — images included — goes through the stash pipeline**: the file is written to the session workspace at `<cwd>/.dsh/uploads/` and staged per session, and a card (icon tile + file name + size + ✕) appears above the composer. Nothing uses the host's native draft-image pipeline (`createDraftImages`/`addImages` are not used); if the model needs to see an image, it reads it by path with the harness-native `read_image` tool, so non-vision models are never blocked by "this model doesn't support images".
- **The draft stays completely clean** — no reference text is ever written into the input box. When you send your next message, the host folds the attachment list into the model request during the `agent/pre-step` wave as a message with `source: { kind: 'user' }` (inserted right before your message, same injection pattern as the official dsh-agent-instructions), so it lands in the logs and replays safely. After injection the cards disappear automatically.
- Whether — and how — to handle a file is the model's business. The plugin does no type sniffing, so there is no "unsupported format" rejection. The only hard limit is the 32 MB per-file RPC transfer cap (put larger files directly into the project directory and reference the path in your message).

## Entry points

1. **Paperclip button** (left end of the input toolbar): opens a file picker, multi-select, no `accept` filter.
2. **Full-window drag & drop**: dragging files anywhere over the window shows an overlay hint; drop to bring them in.
3. **Paste**: pasting files lands them through the same intake. Pasting text that contains attachment reference lines (`📎 … → .dsh/uploads/…`, e.g. copied from a previous message) re-materializes them as cards.

## Attachment cards

Stashed files render as cards above the composer (`conversation.input.dock`): extension icon tile + file name + size + ✕. The ✕ removes the file from the session stash and deletes it from disk. Image cards carry a local thumbnail preview. Cards are backed by the host-side pending list as the source of truth (`listStash`) and refresh via 2-second polling (they vanish once the stash is consumed by a send). Clicking a card opens a preview overlay: images render directly, text/code render as plain text, everything else offers "open with system app", and the header carries a "copy reference" action whose text is the attachment's wire format — paste it back into the composer to re-attach.

## Architecture

- **Host half** (`lib/index.js`): `AttachmentsGateway` extends `TypertRemoteService` and serves the `fileStash` namespace with **six RPCs**: `stashFile`, `removeStash`, `restageFile`, `clearStash`, `readStash`, `listStash`. Path safety: writes only under `<cwd>/.dsh/uploads/`, file names are sanitized and prefixed with a timestamp, and removal/preview paths are resolved and prefix-checked. Because third-party dual-copy setups are blind to SRC discovery, the plugin also registers a weak (src-json) manifest into the host typert registry.
- **Browser half** (`lib/client.js`): hand-written strict zod descriptors mounted via `$mount`, exposing `ctx.remote.fileStash`; the button registers `conversation.input.left`, the card bar registers `conversation.input.dock`; full-window drag/paste routes through the "current composer" context captured by the store. The host folds pending attachments into the next `agent/pre-step` decision.
- **Localization**: full zh/en dictionaries registered through the harness locale service (namespace `dsh-attachments`). Slot components receive the standard reactive `t` seat; window-level modules (dropzone overlay, preview, history cards, intake toasts) translate at call time via a namespace-bound `t`. Host-side RPC failures carry a stable dot-code plus `{name}` params (e.g. `stash.err.tooLarge` with `{max}`) alongside a Chinese fallback message — the client renders the localized text when its dictionary has the code, otherwise the fallback. The `📎 … → path` reference-line format injected into the model's history is protocol text and is never localized.

## Install

Install from npm:

```sh
dsh plugin --profile web add dsh-attachments
```

All three dsh plugins can be added in one command:

```sh
dsh plugin --profile web add dsh-skills dsh-attachments dsh-inspector
```

GitHub fallback:

```sh
dsh plugin --profile web add github:CocoSgt/dsh-attachments
```

> Note: a self-built profile's `~/.dsh/profiles/<name>/package.json` must list
> `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` in
> `dsh.profile.bundles`, otherwise startup hangs silently.

Restart `dsh web` afterwards. Uninstall:
`dsh plugin --profile web remove dsh-attachments`.

## Companion plugins

The other two plugins from the same suite:

- [dsh-skills](https://github.com/CocoSgt/dsh-skills)
  ([npm](https://www.npmjs.com/package/dsh-skills)) — a skill hub: aggregate
  skills scattered across Claude Code directories, projects, and `.skill`
  packages into one global library, invocable from the "/" menu.
- [dsh-inspector](https://github.com/CocoSgt/dsh-inspector)
  ([npm](https://www.npmjs.com/package/dsh-inspector)) — an "Instruction
  Files" panel showing the exact AGENTS.md/CLAUDE.md instruction chain in
  effect for the session, in real load order, with in-place editing and
  skill-root status.

## Known limitations

- Stashing requires the session to have a workspace directory (cwd). **Without a workspace, every file type fails** — there is nowhere to put the file.
- 32 MB per-file transfer cap (a JSON-wire reality); oversized files fail loudly, never silently.
- The pending stash lives in host memory: after a dsh restart, unsent cards are gone (the files remain in the uploads directory and can be dragged in again). With the same session open in multiple clients, cards follow host state truthfully: opening or refreshing a page never clears the stash (loading is read-only), a send from any client consumes the pending entries everywhere (cards vanish via polling; the uploaded files stay on disk because the sent message references them), and only the ✕ buttons remove files.
- `.dsh/uploads/` is not garbage-collected automatically; the card ✕ deletes the corresponding file, and files referenced by already-sent messages should be kept (history still points at them).

## Development

```sh
pnpm install
pnpm run check   # tsc --noEmit
pnpm run build   # tsdown (host + browser bundle)
```

Note: host method parameter names ARE the RPC wire field names (Gateway SRC mode) — the build must never mangle parameter names.

## Tags

This package and its repository carry the `dsh-plugin`, `dsh`, `deepseek-harness`
and related keywords/topics. DeepSeek Harness ships no official plugin
marketplace and no official discovery tag — once a third-party plugin is
published, nothing links it back to the ecosystem and users have no way to
find it. These community tags are the only practical discovery channel
(npm: `keywords:dsh-plugin`; GitHub: `topic:dsh-plugin`). Unofficial, but
essential — that is why they are here.

## License

MIT
