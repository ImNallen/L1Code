import { useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { commit, setCommitMessage, useCommitMessage } from "./state";

/** With nothing staged, committing stages every change first. */
export function CommitBox({ stagedCount, totalCount }: { stagedCount: number; totalCount: number }) {
  const message = useCommitMessage();
  const [busy, setBusy] = useState(false);
  const canCommit = !busy && message.trim().length > 0 && totalCount > 0;

  const run = async () => {
    if (!canCommit) return;
    setBusy(true);
    const ok = await commit(message.trim(), stagedCount === 0);
    setBusy(false);
    if (ok) setCommitMessage("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div className="chg-commit">
      <textarea
        className="input"
        rows={2}
        placeholder={`Message (${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"}Enter to commit)`}
        value={message}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="btn primary" disabled={!canCommit} onClick={() => void run()} title={stagedCount === 0 ? "Stage all changes and commit" : "Commit staged changes"}>
        <Check size={14} />
        {stagedCount === 0 ? "Commit All" : `Commit ${stagedCount} Staged`}
      </button>
    </div>
  );
}
