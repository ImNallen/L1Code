mod error;
mod fonts;
mod fs;
mod gh;
mod git;
mod paths;
mod pty;
mod watch;
mod workspace;

use tauri::{Emitter, Manager};
use tauri_specta::{collect_commands, Builder};

/// The one list of commands. TypeScript bindings in `src/core/bindings.gen.ts` derive from it.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        workspace::workspace_open,
        workspace::workspace_close,
        workspace::app_initial_path,
        workspace::app_path_kind,
        fs::fs_read,
        fs::fs_write,
        fs::fs_list,
        fs::fs_create,
        fs::fs_rename,
        fs::fs_delete,
        git::git_status,
        git::git_diff,
        git::git_stage,
        git::git_unstage,
        git::git_discard,
        git::git_commit,
        gh::gh_pr_view,
        gh::gh_pr_create_web,
        fonts::fonts_list,
        pty::pty_open,
        pty::pty_attach,
        pty::pty_write,
        pty::pty_resize,
        pty::pty_kill,
        pty::pty_list,
    ])
}

const BINDINGS: &str = "../src/core/bindings.gen.ts";

fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default().header("// @ts-nocheck\n/* eslint-disable */"),
            BINDINGS,
        )
        .expect("failed to export TypeScript bindings");
}

/// First non-flag CLI argument, resolved against `cwd`.
fn path_arg(args: &[String], cwd: &std::path::Path) -> Option<String> {
    let arg = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    Some(cwd.join(arg).to_string_lossy().into_owned())
}

/// Emitted when a second `l1code <path>` launch hands its path to this instance.
const OPEN_PATH_EVENT: &str = "open-path";

pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().collect();
    let initial = path_arg(&args, &cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(path) = path_arg(&argv, std::path::Path::new(&cwd)) {
                let _ = app.emit(OPEN_PATH_EVENT, path);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(workspace::AppState::with_initial_path(initial))
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running L1Code");
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
