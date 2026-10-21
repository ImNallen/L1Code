import { useEffect, useState } from "react";
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage } from "@/core/ipc";
import { useStore } from "@/core/store";
import { toast } from "@/core/toast";
import { navigate, previewState, reload } from "./state";
import "./preview.css";

type Viewport = "full" | "tablet" | "mobile";

const VIEWPORTS: readonly { id: Viewport; label: string; width: number | null; icon: typeof Monitor }[] = [
  { id: "full", label: "Full width", width: null, icon: Monitor },
  { id: "tablet", label: "Tablet (768px)", width: 768, icon: Tablet },
  { id: "mobile", label: "Mobile (390px)", width: 390, icon: Smartphone },
];

const QUICK_PORTS = [3000, 5173, 8080, 4321];

export default function PreviewTool() {
  const { url, reloadKey } = useStore(previewState);
  const [draft, setDraft] = useState(url);
  const [viewport, setViewport] = useState<Viewport>("full");

  useEffect(() => setDraft(url), [url]);

  const openExternal = () => {
    if (url) openUrl(url).catch((e) => toast(errorMessage(e), "error"));
  };

  const width = VIEWPORTS.find((v) => v.id === viewport)?.width ?? null;

  return (
    <div className="panel preview-tool">
      <form
        className="preview-bar"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(draft);
        }}
      >
        <button type="button" className="icon-btn" title="Reload" disabled={!url} onClick={reload}>
          <RotateCw />
        </button>
        <input
          className="input mono preview-url"
          value={draft}
          placeholder="localhost:3000"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(url);
              e.currentTarget.blur();
            }
          }}
        />
        {VIEWPORTS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`icon-btn${viewport === v.id ? " active" : ""}`}
            title={v.label}
            onClick={() => setViewport(v.id)}
          >
            <v.icon />
          </button>
        ))}
        <button type="button" className="icon-btn" title="Open in browser" disabled={!url} onClick={openExternal}>
          <ExternalLink />
        </button>
      </form>
      {url ? (
        <>
          <div className="preview-stage">
            <iframe
              key={`${url}#${reloadKey}`}
              className={`preview-frame${width ? " sized" : ""}`}
              style={width ? { width } : undefined}
              src={url}
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </div>
          <div className="preview-note">
            Some sites refuse to be framed. Use <ExternalLink className="inline-icon" /> to open in the browser.
          </div>
        </>
      ) : (
        <div className="empty preview-empty">
          <div>Enter a URL or a port to preview a dev server.</div>
          <div className="preview-ports">
            {QUICK_PORTS.map((p) => (
              <button key={p} type="button" className="btn mono" onClick={() => navigate(String(p))}>
                :{p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
