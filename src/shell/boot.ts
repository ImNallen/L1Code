// Startup and workspace switching. Switching folders reloads the page so every slice starts clean;
// Rust keeps terminals only when the same folder is reopened.

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { IpcError } from "@/core/ipc";
import { bindSession } from "@/core/session";
import { allExtras, type PersistSpec } from "@/core/slice";
import { toast } from "@/core/toast";
import { currentRoot, onLaunchPath, openWorkspace, recentWorkspaces } from "@/core/workspace";
import { editor } from "@/slices/editor";
import { manifest } from "@/slices/manifest";
import { layoutSpec } from "./layout";

const PENDING = "l1code.pending-open";

/** Opens `absPath` (a folder, or a file inside the folder to open). Reloads if a folder is already open. */
export async function openPath(absPath: string): Promise<void> {
  const root = currentRoot();
  if (root && (absPath === root || absPath.startsWith(root + "/"))) {
    const rel = absPath.slice(root.length + 1);
    if (rel) void editor.open(rel);
    return;
  }
  if (root) {
    if (!(await editor.closeAll())) return;
    sessionStorage.setItem(PENDING, absPath);
    location.reload();
    return;
  }
  await openFresh(absPath);
}

export async function pickFolder(): Promise<void> {
  const picked = await openDialog({ directory: true, multiple: false, title: "Open Folder" });
  if (typeof picked === "string") await openPath(picked);
}

async function openFresh(absPath: string): Promise<void> {
  let file: string | null = null;
  try {
    await openWorkspace(absPath);
  } catch (e) {
    // A file path: open its folder, then the file.
    if (e instanceof IpcError && e.kind === "invalidPath") {
      const cut = absPath.lastIndexOf("/");
      file = absPath.slice(cut + 1);
      try {
        await openWorkspace(absPath.slice(0, cut) || "/");
      } catch {
        toast(`Can't open ${absPath}`, "error");
        return;
      }
    } else {
      toast(`Can't open ${absPath}: ${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
  }
  await activate();
  if (file) void editor.open(file);
}

let deactivate: (() => void) | null = null;

async function activate(): Promise<void> {
  const root = currentRoot();
  if (!root) return;
  const extras = allExtras(manifest);
  const cleanups = extras.map((e) => e.activate?.()).filter((c): c is () => void => typeof c === "function");
  const specs = [layoutSpec, ...extras.flatMap((e) => e.persist ?? [])] as PersistSpec<unknown>[];
  const unbind = await bindSession(root, specs);
  deactivate = () => {
    unbind();
    cleanups.forEach((c) => c());
  };
}

/** Runs once at startup. */
export async function boot(): Promise<void> {
  const pending = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  let launched = false;
  await onLaunchPath((p) => {
    launched = true;
    void openPath(p);
  });
  if (launched) return;
  const target = pending ?? lastWorkspace();
  if (target) await openFresh(target);
}

function lastWorkspace(): string | null {
  return recentWorkspaces()[0] ?? null;
}

window.addEventListener("beforeunload", () => deactivate?.());
