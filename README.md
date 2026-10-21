# L1Code

A small, fast IDE for quick edits and testing. Built with Tauri 2 and React.

- **Left:** the file tree, with a filter on top.
- **Middle:** a tabbed CodeMirror editor.
- **Right:** Preview, Pull Request, Terminal, and Changes, where you stage and commit.

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
| Filter files | ⌘⇧E |
| Terminal | ⌃` |
| Changes | ⌘⇧D |
| Toggle the left or right column | ⌘B, ⌘J |
| Save, close tab | ⌘S, ⌘W |
| Open folder | ⌘O |

Running `l1code <path>` again hands the path to the running window. If `<path>` is a file, L1Code opens its folder and then the file.

See [docs/architecture.md](docs/architecture.md) for the design.
