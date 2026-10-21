//! Workspace text search on the ripgrep engine. Hits stream over a Channel in per-file batches.
//! Starting a search cancels the previous one through the workspace's search ticket.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::workspace::AppState;

const MAX_MATCHES: usize = 10_000;
const MAX_LINE_CHARS: usize = 300;
/// Hits kept per file. Hitting it marks the whole search as truncated.
const MAX_PER_FILE: usize = 1000;

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchQuery {
    pub(crate) pattern: String,
    pub(crate) regex: bool,
    pub(crate) case_sensitive: bool,
    pub(crate) whole_word: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hit {
    /// 1-based line number.
    pub(crate) line: u32,
    /// The line, trimmed to a preview length.
    pub(crate) text: String,
    /// Match ranges in `text` as character offsets `[start, end)`.
    pub(crate) ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHits {
    pub(crate) path: RelPath,
    pub(crate) hits: Vec<Hit>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchSummary {
    pub(crate) files: u32,
    pub(crate) matches: u32,
    pub(crate) truncated: bool,
    pub(crate) cancelled: bool,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn search_text(state: State<'_, AppState>, query: SearchQuery, on_hits: Channel<Vec<FileHits>>) -> Result<SearchSummary> {
    let ws = state.workspace()?;
    let ticket = ws.search_ticket.fetch_add(1, Ordering::SeqCst) + 1;
    let pattern = if query.regex { query.pattern.clone() } else { regex_escape(&query.pattern) };
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!query.case_sensitive)
        .word(query.whole_word)
        .build(&pattern)
        .map_err(|e| Error::InvalidPath(e.to_string()))?;

    crate::git::blocking(move || {
        let root = ws.root.clone();
        let total = Arc::new(Mutex::new((0u32, 0u32, false)));
        let cancelled = || ws.search_ticket.load(Ordering::SeqCst) != ticket;
        ignore::WalkBuilder::new(&root)
            .hidden(false)
            .require_git(false)
            .filter_entry(|e| e.file_name() != ".git")
            .build_parallel()
            .run(|| {
                let matcher = matcher.clone();
                let total = total.clone();
                let on_hits = on_hits.clone();
                let root = root.clone();
                let mut searcher = SearcherBuilder::new().binary_detection(BinaryDetection::quit(0)).line_number(true).build();
                Box::new(move |entry| {
                    if cancelled() {
                        return ignore::WalkState::Quit;
                    }
                    let Ok(entry) = entry else { return ignore::WalkState::Continue };
                    if !entry.file_type().is_some_and(|t| t.is_file()) {
                        return ignore::WalkState::Continue;
                    }
                    let Some(path) = RelPath::from_abs(&root, entry.path()) else { return ignore::WalkState::Continue };
                    let mut hits = Vec::new();
                    let _ = searcher.search_path(
                        &matcher,
                        entry.path(),
                        UTF8(|line_no, line| {
                            hits.push(hit(&matcher, line_no, line));
                            Ok(hits.len() < MAX_PER_FILE)
                        }),
                    );
                    if hits.is_empty() {
                        return ignore::WalkState::Continue;
                    }
                    let mut t = total.lock().unwrap();
                    t.0 += 1;
                    t.1 += hits.len() as u32;
                    t.2 |= hits.len() >= MAX_PER_FILE;
                    let _ = on_hits.send(vec![FileHits { path, hits }]);
                    if t.1 as usize >= MAX_MATCHES {
                        t.2 = true;
                        return ignore::WalkState::Quit;
                    }
                    ignore::WalkState::Continue
                })
            });
        let (files, matches, truncated) = *total.lock().unwrap();
        Ok(SearchSummary { files, matches, truncated, cancelled: cancelled() })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) fn search_cancel(state: State<'_, AppState>) -> Result<()> {
    state.workspace()?.search_ticket.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

fn hit(matcher: &grep_regex::RegexMatcher, line_no: u64, line: &str) -> Hit {
    let line = line.trim_end_matches(['\n', '\r']);
    let mut ranges = Vec::new();
    let _ = matcher.find_iter(line.as_bytes(), |m| {
        let start = line[..m.start()].chars().count() as u32;
        let end = start + line[m.start()..m.end()].chars().count() as u32;
        if (start as usize) < MAX_LINE_CHARS {
            ranges.push((start, end.min(MAX_LINE_CHARS as u32)));
        }
        true
    });
    Hit { line: line_no as u32, text: line.chars().take(MAX_LINE_CHARS).collect(), ranges }
}

fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if "\\.+*?()|[]{}^$#&-~".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
