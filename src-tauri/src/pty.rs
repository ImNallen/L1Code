//! Terminal sessions. Rust owns each PTY for the life of the workspace, so hiding the Terminal tab
//! or reloading the window never kills a shell. A reader thread drains output into a ring addressed
//! by a running byte offset; attaching replays the ring and then streams live output.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::workspace::AppState;

const RING_BYTES: usize = 1 << 20;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PtyEvent {
    /// `start` is the stream offset of `data`'s first byte. Clients skip what they already have.
    Data { start: f64, data: String },
    Exit { code: Option<i32> },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalInfo {
    pub(crate) id: u32,
    pub(crate) title: String,
    pub(crate) exited: bool,
}

#[derive(Default)]
pub(crate) struct Terminals {
    sessions: Mutex<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}

impl Drop for Terminals {
    fn drop(&mut self) {
        for (_, s) in self.sessions.lock().unwrap().drain() {
            s.kill();
        }
    }
}

struct Session {
    id: u32,
    title: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    out: Mutex<Output>,
}

#[derive(Default)]
struct Output {
    ring: VecDeque<(f64, String)>,
    ring_bytes: usize,
    end: f64,
    attached: Option<Channel<PtyEvent>>,
    exit: Option<Option<i32>>,
}

impl Output {
    fn push(&mut self, data: String) {
        let start = self.end;
        self.end += data.len() as f64;
        self.ring_bytes += data.len();
        self.ring.push_back((start, data.clone()));
        while self.ring_bytes > RING_BYTES && self.ring.len() > 1 {
            if let Some((_, old)) = self.ring.pop_front() {
                self.ring_bytes -= old.len();
            }
        }
        if let Some(ch) = &self.attached {
            if ch.send(PtyEvent::Data { start, data }).is_err() {
                self.attached = None;
            }
        }
    }
}

impl Session {
    fn info(&self) -> TerminalInfo {
        TerminalInfo { id: self.id, title: self.title.clone(), exited: self.out.lock().unwrap().exit.is_some() }
    }

    fn kill(&self) {
        let _ = self.killer.lock().unwrap().kill();
    }
}

impl Terminals {
    fn get(&self, id: u32) -> Result<Arc<Session>> {
        self.sessions.lock().unwrap().get(&id).cloned().ok_or_else(|| Error::NotFound(format!("terminal {id}")))
    }
}

fn shell() -> String {
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn pty_open(state: State<'_, AppState>, cwd: Option<RelPath>, cols: u16, rows: u16) -> Result<TerminalInfo> {
    let ws = state.workspace()?;
    let dir = cwd.and_then(|c| ws.path(&c).ok()).filter(|p| p.is_dir()).unwrap_or_else(|| ws.root.clone());
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| Error::Io(e.to_string()))?;
    let sh = shell();
    let mut cmd = CommandBuilder::new(&sh);
    cmd.arg("-l");
    cmd.cwd(&dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "L1Code");
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| Error::Io(e.to_string()))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| Error::Io(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| Error::Io(e.to_string()))?;

    let id = ws.terminals.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let title = std::path::Path::new(&sh).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "shell".into());
    let session = Arc::new(Session {
        id,
        title,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
        out: Mutex::new(Output::default()),
    });

    let s = session.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 64 * 1024];
        let mut carry = Vec::new();
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            carry.extend_from_slice(&buf[..n]);
            let text = take_utf8(&mut carry);
            if !text.is_empty() {
                s.out.lock().unwrap().push(text);
            }
        }
    });
    let s = session.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|st| st.exit_code() as i32);
        let mut out = s.out.lock().unwrap();
        out.exit = Some(code);
        if let Some(ch) = &out.attached {
            let _ = ch.send(PtyEvent::Exit { code });
        }
    });

    let info = session.info();
    ws.terminals.sessions.lock().unwrap().insert(id, session);
    Ok(info)
}

/// Splits off the longest valid UTF-8 prefix of `buf`, leaving an incomplete trailing sequence.
/// Invalid bytes become U+FFFD so a broken program can't stall the stream.
fn take_utf8(buf: &mut Vec<u8>) -> String {
    match std::str::from_utf8(buf) {
        Ok(s) => {
            let out = s.to_string();
            buf.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            if e.error_len().is_none() && buf.len() - valid < 4 {
                let rest = buf.split_off(valid);
                let out = String::from_utf8(std::mem::replace(buf, rest)).unwrap_or_default();
                out
            } else {
                let out = String::from_utf8_lossy(buf).into_owned();
                buf.clear();
                out
            }
        }
    }
}

/// Streams a session's output to `on_event`, starting with everything still in the ring.
/// Replaces any previous attachment, so a reloaded page simply re-attaches.
#[tauri::command]
#[specta::specta]
pub(crate) fn pty_attach(state: State<'_, AppState>, id: u32, on_event: Channel<PtyEvent>) -> Result<()> {
    let s = state.workspace()?.terminals.get(id)?;
    let mut out = s.out.lock().unwrap();
    for (start, data) in &out.ring {
        let _ = on_event.send(PtyEvent::Data { start: *start, data: data.clone() });
    }
    if let Some(code) = out.exit {
        let _ = on_event.send(PtyEvent::Exit { code });
    }
    out.attached = Some(on_event);
    drop(out);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn pty_write(state: State<'_, AppState>, id: u32, data: String) -> Result<()> {
    let s = state.workspace()?.terminals.get(id)?;
    let mut w = s.writer.lock().unwrap();
    w.write_all(data.as_bytes())?;
    w.flush()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn pty_resize(state: State<'_, AppState>, id: u32, cols: u16, rows: u16) -> Result<()> {
    if cols < 2 || rows < 2 {
        return Ok(());
    }
    let s = state.workspace()?.terminals.get(id)?;
    let result = s.master.lock().unwrap().resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    result.map_err(|e| Error::Io(e.to_string()))
}

/// Kills and forgets a session. Idempotent.
#[tauri::command]
#[specta::specta]
pub(crate) fn pty_kill(state: State<'_, AppState>, id: u32) -> Result<()> {
    let ws = state.workspace()?;
    if let Some(s) = ws.terminals.sessions.lock().unwrap().remove(&id) {
        s.kill();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn pty_list(state: State<'_, AppState>) -> Result<Vec<TerminalInfo>> {
    let ws = state.workspace()?;
    let mut list: Vec<_> = ws.terminals.sessions.lock().unwrap().values().map(|s| s.info()).collect();
    list.sort_by_key(|t| t.id);
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_carry() {
        let mut buf = "aé".as_bytes().to_vec();
        let last = buf.pop().unwrap();
        assert_eq!(take_utf8(&mut buf), "a");
        assert_eq!(buf.len(), 1);
        buf.push(last);
        assert_eq!(take_utf8(&mut buf), "é");
        assert!(buf.is_empty());
    }

    #[test]
    fn ring_drops_oldest() {
        let mut out = Output::default();
        out.push("x".repeat(RING_BYTES));
        out.push("y".repeat(10));
        assert_eq!(out.ring.len(), 1);
        assert_eq!(out.ring[0].0, RING_BYTES as f64);
        assert_eq!(out.end, (RING_BYTES + 10) as f64);
    }
}
