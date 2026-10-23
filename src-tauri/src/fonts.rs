//! Installed font families for the settings font pickers. WKWebView has no `queryLocalFonts`, so the
//! list comes from the system font directories.

use std::collections::BTreeMap;

use serde::Serialize;
use specta::Type;

use crate::error::Result;
use crate::git::blocking;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub(crate) struct FontFamily {
    pub(crate) name: String,
    /// Some face of the family is fixed-width.
    pub(crate) mono: bool,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn fonts_list() -> Result<Vec<FontFamily>> {
    blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        // fontdb lists a face's English family name first. Its `monospaced` reads only the `post`
        // table flag, which Monaco and Courier leave unset, so measure the faces it rejects.
        Ok(families(db.faces().filter_map(|f| {
            let mono = f.monospaced || db.with_face_data(f.id, fixed_width).unwrap_or(false);
            Some((f.families.first()?.0.as_str(), mono))
        })))
    })
    .await
}

/// Whether `i`, `M`, `W`, and `0` all exist and share one advance width.
fn fixed_width(data: &[u8], index: u32) -> bool {
    let Ok(face) = ttf_parser::Face::parse(data, index) else { return false };
    let advances: Option<Vec<u16>> = ['i', 'M', 'W', '0'].iter().map(|&c| face.glyph_hor_advance(face.glyph_index(c)?)).collect();
    advances.is_some_and(|a| a.iter().all(|&w| w == a[0]))
}

/// One entry per family name, sorted case-insensitively. Dot-prefixed families are macOS internals.
fn families<'a>(faces: impl Iterator<Item = (&'a str, bool)>) -> Vec<FontFamily> {
    let mut mono: BTreeMap<&str, bool> = BTreeMap::new();
    for (name, is_mono) in faces.filter(|(name, _)| !name.is_empty() && !name.starts_with('.')) {
        *mono.entry(name).or_default() |= is_mono;
    }
    let mut out: Vec<FontFamily> = mono.into_iter().map(|(name, mono)| FontFamily { name: name.to_owned(), mono }).collect();
    out.sort_by_cached_key(|f| f.name.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn family(name: &str, mono: bool) -> FontFamily {
        FontFamily { name: name.into(), mono }
    }

    #[test]
    fn merges_faces_into_sorted_families() {
        let faces = [("Menlo", true), ("arial", false), ("Menlo", false), (".SF NS", false), ("", true), ("Fira Code", false), ("Fira Code", true)];
        assert_eq!(families(faces.into_iter()), vec![family("arial", false), family("Fira Code", true), family("Menlo", true)]);
    }

    #[test]
    #[ignore = "reads the machine's fonts; run with --ignored to print them"]
    fn lists_system_fonts() {
        let list = tauri::async_runtime::block_on(fonts_list()).unwrap();
        assert!(!list.is_empty());
        println!("{}", serde_json::to_string(&list).unwrap());
    }
}
