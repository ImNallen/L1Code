import { createRoot } from "react-dom/client";
import { boot } from "@/shell/boot";
import { Shell } from "@/shell/Shell";
import "./styles.css";

// No <StrictMode>: its dev-only double mount races @pierre/diffs' async highlighting and leaves
// some diffs permanently empty (reproduced with plain PatchDiff, @pierre/diffs 1.5.2).
createRoot(document.getElementById("root")!).render(<Shell />);

void boot();
