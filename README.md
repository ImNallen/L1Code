# L1Code

A small, fast IDE for quick edits and testing. Built with Tauri 2 and React.

- **Left:** Search, Explorer, and Source Control.
- **Middle:** a tabbed CodeMirror editor.
- **Right:** Preview, Pull Request, Terminal, and Changes.

## Develop

```sh
pnpm install
pnpm tauri dev -- -- /path/to/folder   # opens that folder
```

Checks:

```sh
pnpm typecheck && pnpm lint && pnpm test
cd src-tauri && cargo test               # also regenerates src/core/bindings.gen.ts
```

## Use

| Action | Keys |
| --- | --- |
| Quick open | ⌘P |
| Search in files | ⌘⇧F |
| Explorer, Source Control | ⌘⇧E, ⌘⇧G |
| Terminal | ⌃` |
| Changes | ⌘⇧D |
| Toggle the left or right column | ⌘B, ⌘J |
| Save, close tab | ⌘S, ⌘W |
| Open folder | ⌘O |

Running `l1code <path>` again hands the path to the running window. If `<path>` is a file, L1Code opens its folder and then the file.

See [docs/architecture.md](docs/architecture.md) for the design.
