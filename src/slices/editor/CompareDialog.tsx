import { MultiFileDiff } from "@pierre/diffs/react";
import { X } from "lucide-react";

export default function CompareDialog(props: { path: string; disk: string; mine: string; onClose(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="modal compare" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">
          Disk ← → Your edits: {props.path}
          <div className="spacer" />
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="panel-body">
          <MultiFileDiff
            oldFile={{ name: props.path, contents: props.disk }}
            newFile={{ name: props.path, contents: props.mine }}
            options={{ theme: { light: "pierre-light", dark: "pierre-dark" }, themeType: "system", diffStyle: "split" }}
          />
        </div>
      </div>
    </div>
  );
}
