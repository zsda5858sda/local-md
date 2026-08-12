use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use chrono::Utc;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tempfile::Builder as TempBuilder;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const SETTINGS_VERSION: u64 = 1;
const SNAPSHOT_RETENTION: usize = 5;
const SNAPSHOT_MIN_INTERVAL: Duration = Duration::from_secs(60);
const MAX_MARKDOWN_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

struct WatchState(Mutex<Option<RecommendedWatcher>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: String,
    size: u64,
    modified_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<WorkspaceEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFormatProfile {
    encoding: String,
    bom: String,
    eol: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskDocument {
    path: String,
    relative_path: String,
    content: String,
    hash: String,
    profile: FileFormatProfile,
    size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    root: String,
    relative_path: String,
    content: String,
    expected_hash: Option<String>,
    profile: FileFormatProfile,
    #[serde(default)]
    force: bool,
    save_generation: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    hash: String,
    save_generation: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind")]
enum SaveError {
    Conflict {
        expected: Option<String>,
        actual: Option<String>,
    },
    Io {
        message: String,
    },
    Encoding {
        message: String,
    },
}

impl SaveError {
    fn io(message: impl Into<String>) -> Self {
        Self::Io { message: message.into() }
    }

    fn encoding(message: impl Into<String>) -> Self {
        Self::Encoding { message: message.into() }
    }
}

impl From<String> for SaveError {
    fn from(message: String) -> Self {
        Self::io(message)
    }
}

impl From<&str> for SaveError {
    fn from(message: &str) -> Self {
        Self::io(message)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResult {
    settings: serde_json::Value,
    read_only: bool,
    warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    succeeded: usize,
    failed: usize,
    files: Vec<ImportFileResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFileResult {
    relative_path: String,
    status: String,
    source_encoding: Option<String>,
    error: Option<String>,
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_relative(relative: &str) -> Result<PathBuf, String> {
    let value = Path::new(relative);
    if value.as_os_str().is_empty() || value.is_absolute() {
        return Err("路徑必須是 Workspace 內的相對路徑".into());
    }
    if value.components().any(|part| matches!(part, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("拒絕 path traversal：路徑不得離開 Workspace".into());
    }
    Ok(value.to_path_buf())
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|error| format!("Workspace 無法開啟：{error}"))?;
    if !root.is_dir() {
        return Err("Workspace root 不是資料夾".into());
    }
    Ok(root)
}

fn scoped_path(root: &str, relative: &str, existing: bool) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_root(root)?;
    let relative = validate_relative(relative)?;
    let target = root.join(relative);
    let boundary = if existing {
        fs::canonicalize(&target).map_err(|error| format!("路徑不存在：{error}"))?
    } else {
        let parent = target.parent().ok_or("無法判定父資料夾")?;
        let canonical_parent = fs::canonicalize(parent).map_err(|error| format!("父資料夾不存在：{error}"))?;
        canonical_parent.join(target.file_name().ok_or("檔名無效")?)
    };
    if !boundary.starts_with(&root) {
        return Err("拒絕 symlink escape：目標位於 Workspace 外".into());
    }
    Ok((root, target))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, 0x50, 0x4E, 0x47, ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x47, 0x49, 0x46, 0x38, ..] => Some("image/gif"),
        bytes if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => Some("image/webp"),
        [0x42, 0x4D, ..] => Some("image/bmp"),
        _ => None,
    }
}

fn scan_directory(root: &Path, directory: &Path) -> Result<Vec<WorkspaceEntry>, String> {
    let mut entries = Vec::new();
    for item in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".snapshots" || name == ".git" || name == "node_modules" || name == ".editor-config.json" || name.ends_with(".corrupt") {
            continue;
        }
        let file_type = item.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
        let metadata = item.metadata().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            entries.push(WorkspaceEntry {
                name,
                path: path.to_string_lossy().to_string(),
                relative_path: relative,
                kind: "directory".into(),
                size: 0,
                modified_at: modified_millis(&metadata),
                children: Some(scan_directory(root, &path)?),
            });
        } else if file_type.is_file() && is_markdown(&path) {
            entries.push(WorkspaceEntry {
                name,
                path: path.to_string_lossy().to_string(),
                relative_path: relative,
                kind: "file".into(),
                size: metadata.len(),
                modified_at: modified_millis(&metadata),
                children: None,
            });
        }
    }
    entries.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank.cmp(&right_rank).then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn detect_eol(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let remainder = text.replace("\r\n", "");
    let cr = remainder.matches('\r').count();
    let lf = remainder.matches('\n').count();
    if crlf > 0 && crlf >= cr && crlf >= lf { "crlf" } else if cr > lf { "cr" } else { "lf" }
}

fn detect_and_decode(bytes: &[u8]) -> Result<(String, FileFormatProfile), String> {
    let has_bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let payload = if has_bom { &bytes[3..] } else { bytes };
    let encoding = if has_bom {
        UTF_8
    } else {
        let mut detector = EncodingDetector::new();
        detector.feed(payload, true);
        detector.guess(None, true)
    };
    let decoded = encoding
        .decode_without_bom_handling_and_without_replacement(payload)
        .ok_or_else(|| format!("{} 解碼失敗，為避免亂碼已停止讀取", encoding.name()))?;
    let original = decoded.into_owned();
    let eol = detect_eol(&original).to_string();
    let content = original.replace("\r\n", "\n").replace('\r', "\n");
    let encoding_name = match encoding.name() {
        "UTF-8" => "utf-8",
        "Big5" => "big5",
        "GBK" | "gb18030" => "gbk",
        "Shift_JIS" => "shift_jis",
        other => return Err(format!("不支援的文字編碼：{other}")),
    };
    Ok((content, FileFormatProfile {
        encoding: encoding_name.into(),
        bom: if has_bom { "utf8".into() } else { "none".into() },
        eol,
    }))
}

fn encode_content(content: &str, profile: &FileFormatProfile) -> Result<Vec<u8>, String> {
    let eol = match profile.eol.as_str() { "crlf" => "\r\n", "cr" => "\r", _ => "\n" };
    let disk_text = content.replace("\r\n", "\n").replace('\r', "\n").replace('\n', eol);
    let encoding = Encoding::for_label(profile.encoding.as_bytes()).ok_or_else(|| format!("不支援的編碼：{}", profile.encoding))?;
    let (encoded, _, had_errors) = encoding.encode(&disk_text);
    if had_errors {
        return Err(format!("內容含 {} 無法表示的字元；請轉換為 UTF-8 後再儲存", profile.encoding));
    }
    let mut bytes = encoded.into_owned();
    if profile.bom == "utf8" && encoding == UTF_8 {
        bytes.splice(0..0, [0xef, 0xbb, 0xbf]);
    }
    Ok(bytes)
}

fn current_hash(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() { return Ok(None); }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Some(hash_bytes(&bytes)))
}

fn verify_expected(path: &Path, expected: &Option<String>, force: bool) -> Result<(), SaveError> {
    if force { return Ok(()); }
    let actual = current_hash(path)?;
    if expected.as_ref() != actual.as_ref() {
        return Err(SaveError::Conflict { expected: expected.clone(), actual });
    }
    Ok(())
}

fn create_snapshot(root: &Path, target: &Path, relative: &str, force: bool) -> Result<(), String> {
    if !target.exists() { return Ok(()); }
    let snapshot_dir = root.join(".snapshots").join(relative);
    fs::create_dir_all(&snapshot_dir).map_err(|error| format!("無法建立快照資料夾：{error}"))?;
    let mut snapshots: Vec<(PathBuf, SystemTime)> = fs::read_dir(&snapshot_dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok().and_then(|metadata| metadata.modified().ok().map(|time| (entry.path(), time))))
        .collect();
    snapshots.sort_by_key(|(_, time)| *time);
    if !force {
        if let Some((_, newest)) = snapshots.last() {
            if newest.elapsed().unwrap_or_default() < SNAPSHOT_MIN_INTERVAL { return Ok(()); }
        }
    }
    let extension = target.extension().and_then(|value| value.to_str()).unwrap_or("md");
    let snapshot = snapshot_dir.join(format!("{}.{}", Utc::now().format("%Y%m%dT%H%M%S%.3fZ"), extension));
    fs::copy(target, snapshot).map_err(|error| format!("建立快照失敗：{error}"))?;
    snapshots = fs::read_dir(&snapshot_dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok().and_then(|metadata| metadata.modified().ok().map(|time| (entry.path(), time))))
        .collect();
    snapshots.sort_by_key(|(_, time)| *time);
    let remove_count = snapshots.len().saturating_sub(SNAPSHOT_RETENTION);
    for (path, _) in snapshots.into_iter().take(remove_count) { let _ = fs::remove_file(path); }
    Ok(())
}

#[cfg(unix)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| format!("atomic replace 失敗：{error}"))
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if result == 0 { Err(format!("atomic replace 失敗：{}", std::io::Error::last_os_error())) } else { Ok(()) }
}

#[tauri::command]
fn scan_workspace(root: String) -> Result<Vec<WorkspaceEntry>, SaveError> {
    let root = canonical_root(&root)?;
    Ok(scan_directory(&root, &root)?)
}

#[tauri::command]
fn read_markdown(root: String, relative_path: String) -> Result<DiskDocument, SaveError> {
    let (_, path) = scoped_path(&root, &relative_path, true)?;
    if !is_markdown(&path) { return Err("只允許讀取 .md / .markdown 文件".into()); }
    let metadata = fs::metadata(&path).map_err(|error| format!("讀取檔案資訊失敗：{error}"))?;
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err(format!("檔案超過 {}MB 限制，請使用其他工具開啟", MAX_MARKDOWN_BYTES / 1024 / 1024).into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("讀取失敗：{error}"))?;
    let (content, profile) = detect_and_decode(&bytes).map_err(SaveError::encoding)?;
    Ok(DiskDocument {
        path: path.to_string_lossy().to_string(),
        relative_path,
        content,
        hash: hash_bytes(&bytes),
        profile,
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn write_markdown(request: SaveRequest) -> Result<SaveResult, SaveError> {
    let exists = Path::new(&request.root).join(&request.relative_path).exists();
    let (root, path) = scoped_path(&request.root, &request.relative_path, exists)?;
    if !is_markdown(&path) { return Err("只允許寫入 .md / .markdown 文件".into()); }
    verify_expected(&path, &request.expected_hash, request.force)?;
    let bytes = encode_content(&request.content, &request.profile).map_err(SaveError::encoding)?;
    let parent = path.parent().ok_or("無法判定父資料夾")?;
    let mut temporary = TempBuilder::new().prefix(".local-md-").suffix(".tmp").tempfile_in(parent).map_err(|error| format!("建立暫存檔失敗：{error}"))?;
    temporary.write_all(&bytes).map_err(|error| format!("寫入暫存檔失敗：{error}"))?;
    temporary.as_file().sync_all().map_err(|error| format!("同步暫存檔失敗：{error}"))?;
    verify_expected(&path, &request.expected_hash, request.force)?;
    create_snapshot(&root, &path, &request.relative_path, request.force)?;
    let (_file, temporary_path) = temporary.keep().map_err(|error| format!("保留暫存檔失敗：{error}"))?;
    atomic_replace(&temporary_path, &path)?;
    if let Ok(directory) = File::open(parent) { let _ = directory.sync_all(); }
    Ok(SaveResult { hash: hash_bytes(&bytes), save_generation: request.save_generation + 1 })
}

#[tauri::command]
fn create_entry(root: String, relative_path: String, kind: String) -> Result<(), SaveError> {
    let (_, path) = scoped_path(&root, &relative_path, false)?;
    if path.exists() { return Err("同名檔案或資料夾已存在".into()); }
    match kind.as_str() {
        "directory" => fs::create_dir(&path).map_err(|error| SaveError::io(error.to_string())),
        "file" => {
            if !is_markdown(&path) { return Err("新文件副檔名必須為 .md 或 .markdown".into()); }
            fs::write(&path, b"# Untitled\n").map_err(|error| SaveError::io(error.to_string()))
        }
        _ => Err("未知的項目類型".into()),
    }
}

#[tauri::command]
fn rename_entry(root: String, from: String, to: String) -> Result<(), SaveError> {
    let (canonical, source) = scoped_path(&root, &from, true)?;
    let (_, destination) = scoped_path(&root, &to, false)?;
    if destination.exists() { return Err("目的路徑已存在".into()); }
    if !source.starts_with(&canonical) || !destination.starts_with(&canonical) { return Err("路徑超出 Workspace".into()); }
    fs::rename(source, destination).map_err(|error| SaveError::io(format!("重新命名失敗：{error}")))
}

#[tauri::command]
fn delete_entry(root: String, relative_path: String) -> Result<(), SaveError> {
    let (_, path) = scoped_path(&root, &relative_path, true)?;
    trash::delete(path).map_err(|error| SaveError::io(format!("移至資源回收桶失敗：{error}")))
}

fn default_settings(root: &Path) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "workspaceName": root.file_name().and_then(|value| value.to_str()).unwrap_or("Notes"),
        "settings": {
            "lineBreakMode": "soft",
            "softBreakSerialization": "space",
            "autoSaveDebounceMs": 1500,
            "autoSaveEnabled": true,
            "exportMode": "strict",
            "openFolderFileFormatPolicy": "preserve"
        },
        "ui": { "expandedFolders": [], "lastOpenedFile": null, "openTabs": [], "sidebarWidth": 276, "propertiesWidth": 288, "tabGroups": [], "tabAssignments": {} }
    })
}

fn normalize_settings(root: &Path, value: &serde_json::Value) -> (serde_json::Value, bool) {
    let mut normalized = default_settings(root);
    let Some(input) = value.as_object() else { return (normalized, true); };
    if let Some(name) = input.get("workspaceName").and_then(|item| item.as_str()).filter(|item| !item.trim().is_empty() && item.len() <= 200) {
        normalized["workspaceName"] = serde_json::Value::String(name.to_string());
    }
    if let Some(settings) = input.get("settings").and_then(|item| item.as_object()) {
        if let Some(value) = settings.get("autoSaveDebounceMs").and_then(|item| item.as_u64()).filter(|item| (200..=60_000).contains(item)) {
            normalized["settings"]["autoSaveDebounceMs"] = value.into();
        }
        if let Some(value) = settings.get("autoSaveEnabled").and_then(|item| item.as_bool()) {
            normalized["settings"]["autoSaveEnabled"] = value.into();
        }
        if let Some(value) = settings.get("exportMode").and_then(|item| item.as_str()).filter(|item| matches!(*item, "strict" | "htmlCompat")) {
            normalized["settings"]["exportMode"] = value.into();
        }
        if let Some(value) = settings.get("openFolderFileFormatPolicy").and_then(|item| item.as_str()).filter(|item| matches!(*item, "preserve" | "utf8")) {
            normalized["settings"]["openFolderFileFormatPolicy"] = value.into();
        }
    }
    if let Some(ui) = input.get("ui").and_then(|item| item.as_object()) {
        if let Some(values) = ui.get("expandedFolders").and_then(|item| item.as_array()) {
            normalized["ui"]["expandedFolders"] = values.iter().filter_map(|item| item.as_str()).map(|item| item.into()).collect::<Vec<serde_json::Value>>().into();
        }
        if let Some(values) = ui.get("openTabs").and_then(|item| item.as_array()) {
            normalized["ui"]["openTabs"] = values.iter().filter_map(|item| item.as_str()).map(|item| item.into()).collect::<Vec<serde_json::Value>>().into();
        }
        if let Some(value) = ui.get("sidebarWidth").and_then(|item| item.as_u64()).filter(|item| (224..=420).contains(item)) {
            normalized["ui"]["sidebarWidth"] = value.into();
        }
        if let Some(value) = ui.get("propertiesWidth").and_then(|item| item.as_u64()).filter(|item| (240..=480).contains(item)) {
            normalized["ui"]["propertiesWidth"] = value.into();
        }
        if let Some(groups) = ui.get("tabGroups").and_then(|item| item.as_array()) {
            let groups: Vec<serde_json::Value> = groups.iter().take(50).filter_map(|group| {
                let id = group.get("id")?.as_str()?.trim();
                let name = group.get("name")?.as_str()?.trim();
                if id.is_empty() || name.is_empty() || id.len() > 100 || name.len() > 100 { return None; }
                let color = group.get("color").and_then(|item| item.as_str()).filter(|value| matches!(*value,
                    "#6b7280" | "#5b8def" | "#ef7d72" | "#eabf3b" | "#70bf8b" | "#e879b0" | "#b46de0" | "#56c4d8" | "#f0a15f"
                )).unwrap_or("#6b7280");
                Some(serde_json::json!({ "id": id, "name": name, "color": color, "collapsed": group.get("collapsed").and_then(|item| item.as_bool()).unwrap_or(false) }))
            }).collect();
            normalized["ui"]["tabGroups"] = groups.into();
        }
        if let Some(assignments) = ui.get("tabAssignments").and_then(|item| item.as_object()) {
            let assignments: serde_json::Map<String, serde_json::Value> = assignments.iter().take(5_000)
                .filter_map(|(path, group)| group.as_str().filter(|value| !value.is_empty() && value.len() <= 100).map(|value| (path.clone(), value.into())))
                .collect();
            normalized["ui"]["tabAssignments"] = assignments.into();
        }
        normalized["ui"]["lastOpenedFile"] = ui.get("lastOpenedFile").and_then(|item| item.as_str()).map_or(serde_json::Value::Null, |item| item.into());
    }
    let changed = &normalized != value;
    (normalized, changed)
}

#[tauri::command]
fn read_workspace_settings(root: String) -> Result<SettingsResult, SaveError> {
    let root = canonical_root(&root)?;
    let path = root.join(".editor-config.json");
    if !path.exists() { return Ok(SettingsResult { settings: default_settings(&root), read_only: false, warning: None }); }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => {
            let version = value.get("version").and_then(|item| item.as_u64()).unwrap_or(0);
            if version > SETTINGS_VERSION {
                Ok(SettingsResult {
                    settings: default_settings(&root),
                    read_only: true,
                    warning: Some("設定檔版本較新，已使用安全預設值；舊版 App 不會覆寫原設定。".into()),
                })
            } else {
                let (settings, changed) = normalize_settings(&root, &value);
                Ok(SettingsResult {
                    settings,
                    read_only: false,
                    warning: changed.then(|| "設定檔缺少欄位或含無效值；已套用安全預設值。".into()),
                })
            }
        }
        Err(_) => {
            let backup = root.join(".editor-config.json.corrupt");
            fs::copy(&path, backup).map_err(|error| error.to_string())?;
            Ok(SettingsResult {
                settings: default_settings(&root),
                read_only: false,
                warning: Some("設定檔已損毀；已備份為 .editor-config.json.corrupt 並使用預設值。".into()),
            })
        }
    }
}

#[tauri::command]
fn write_workspace_settings(root: String, settings: serde_json::Value) -> Result<(), SaveError> {
    let root = canonical_root(&root)?;
    let version = settings.get("version").and_then(|item| item.as_u64()).unwrap_or(0);
    if version > SETTINGS_VERSION { return Err("設定檔版本較新，拒絕覆寫".into()); }
    let (settings, _) = normalize_settings(&root, &settings);
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    let mut temporary = TempBuilder::new().prefix(".editor-config-").suffix(".tmp").tempfile_in(&root).map_err(|error| error.to_string())?;
    temporary.write_all(&bytes).map_err(|error| error.to_string())?;
    temporary.write_all(b"\n").map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    let (_file, temporary_path) = temporary.keep().map_err(|error| error.to_string())?;
    Ok(atomic_replace(&temporary_path, &root.join(".editor-config.json"))?)
}

#[tauri::command]
fn watch_workspace(app: AppHandle, state: State<'_, WatchState>, root: String) -> Result<(), SaveError> {
    let root = canonical_root(&root)?;
    let watched_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
        if let Ok(event) = result {
            let paths: Vec<String> = event.paths.into_iter()
                .filter(|path| {
                    let value = path.to_string_lossy();
                    path.starts_with(&watched_root) && !value.contains(".snapshots") && !value.contains(".editor-config-") && !value.ends_with(".editor-config.json")
                })
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            if !paths.is_empty() { let _ = app.emit("workspace-event", serde_json::json!({ "paths": paths })); }
        }
    }).map_err(|error| error.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|error| error.to_string())?;
    *state.0.lock().map_err(|_| SaveError::io("watcher lock poisoned"))? = Some(watcher);
    Ok(())
}

fn normalized_asset_path(document_relative_path: &str, asset_reference: &str) -> Result<PathBuf, String> {
    let decoded = percent_decode_str(asset_reference.split(['?', '#']).next().unwrap_or("")).decode_utf8().map_err(|_| "圖片路徑 URL encoding 無效")?;
    let mut normalized = PathBuf::new();
    let combined = Path::new(document_relative_path).parent().unwrap_or(Path::new("")).join(decoded.as_ref());
    for component in combined.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => { if !normalized.pop() { return Err("圖片路徑離開 Workspace".into()); } }
            Component::RootDir | Component::Prefix(_) => return Err("圖片必須使用 Workspace 相對路徑".into()),
        }
    }
    if normalized.as_os_str().is_empty() { return Err("圖片路徑為空".into()); }
    Ok(normalized)
}

#[tauri::command]
fn read_workspace_asset(root: String, document_relative_path: String, asset_reference: String) -> Result<Option<String>, SaveError> {
    if asset_reference.starts_with('#') || asset_reference.starts_with('/') || Regex::new(r"(?i)^[a-z][a-z\d+.-]*:").map_err(|error| error.to_string())?.is_match(&asset_reference) {
        return Ok(None);
    }
    let relative = normalized_asset_path(&document_relative_path, &asset_reference)?;
    let (_, path) = scoped_path(&root, &relative.to_string_lossy(), true)?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return Err("只允許載入 PNG、JPEG、GIF、WebP 或 BMP 圖片".into()),
    };
    let metadata = fs::metadata(&path).map_err(|error| format!("讀取圖片資訊失敗：{error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES { return Err("圖片超過 20 MB 限制".into()); }
    let bytes = fs::read(&path).map_err(|error| format!("讀取圖片失敗：{error}"))?;
    let detected_mime = sniff_image_mime(&bytes);
    if detected_mime != Some(mime) {
        eprintln!("警告：拒絕副檔名與內容不符的 Workspace 圖片：{}", path.display());
        return Err("圖片副檔名與檔案內容不符".into());
    }
    Ok(Some(format!("data:{mime};base64,{}", BASE64.encode(bytes))))
}

fn secure_import_destination(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if relative.is_absolute() || relative.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("匯入路徑無效".into());
    }
    let mut current = root.to_path_buf();
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            let Component::Normal(part) = component else { return Err("匯入路徑無效".into()); };
            current.push(part);
            if current.exists() {
                let metadata = fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
                if metadata.file_type().is_symlink() { return Err("匯入目標含 symlink，已拒絕寫入".into()); }
            } else {
                fs::create_dir(&current).map_err(|error| error.to_string())?;
            }
            let canonical = fs::canonicalize(&current).map_err(|error| error.to_string())?;
            if !canonical.starts_with(root) { return Err("匯入目標離開 Workspace".into()); }
        }
    }
    Ok(root.join(relative))
}

#[tauri::command]
fn import_workspace(source: String, target: String) -> Result<ImportReport, SaveError> {
    let source = canonical_root(&source)?;
    let target = canonical_root(&target)?;
    if source == target || source.starts_with(&target) || target.starts_with(&source) { return Err("來源與目標 Workspace 不得相同或互相包含".into()); }
    let mut report = ImportReport { succeeded: 0, failed: 0, files: Vec::new() };
    for result in WalkDir::new(&source).follow_links(false).into_iter().filter_entry(|entry| !matches!(entry.file_name().to_str(), Some(".git" | ".snapshots" | "node_modules"))) {
        let entry = match result {
            Ok(entry) => entry,
            Err(error) => {
                report.failed += 1;
                report.files.push(ImportFileResult { relative_path: error.path().map(|path| path.to_string_lossy().to_string()).unwrap_or_else(|| "<unknown>".into()), status: "failed".into(), source_encoding: None, error: Some(error.to_string()) });
                continue;
            }
        };
        if !entry.file_type().is_file() { continue; }
        let relative = entry.path().strip_prefix(&source).map_err(|error| error.to_string())?;
        let relative_string = relative.to_string_lossy().replace('\\', "/");
        let result = (|| -> Result<String, String> {
            let bytes = fs::read(entry.path()).map_err(|error| error.to_string())?;
            let source_encoding = if is_markdown(entry.path()) { Some(detect_and_decode(&bytes)?.1.encoding) } else { None };
            let destination = secure_import_destination(&target, relative)?;
            if destination.exists() { return Err("目標已存在；未覆寫".into()); }
            fs::write(&destination, bytes).map_err(|error| error.to_string())?;
            Ok(source_encoding.unwrap_or_else(|| "binary".into()))
        })();
        match result {
            Ok(encoding) => { report.succeeded += 1; report.files.push(ImportFileResult { relative_path: relative_string, status: "imported".into(), source_encoding: Some(encoding), error: None }); }
            Err(error) => { report.failed += 1; report.files.push(ImportFileResult { relative_path: relative_string, status: "failed".into(), source_encoding: None, error: Some(error) }); }
        }
    }
    Ok(report)
}

#[tauri::command]
fn export_workspace(root: String, destination: String) -> Result<(), SaveError> {
    let root = canonical_root(&root)?;
    let destination_path = PathBuf::from(destination);
    let parent = destination_path.parent().ok_or("無法判定匯出資料夾")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let checked_destination = canonical_parent.join(destination_path.file_name().ok_or("匯出檔名無效")?);
    if checked_destination.starts_with(&root) { return Err("ZIP 不得匯出到 Workspace 內".into()); }
    let mut temporary = TempBuilder::new().prefix(".local-md-export-").suffix(".tmp").tempfile_in(&canonical_parent).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(temporary.as_file_mut());
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut buffer = Vec::new();
    for result in WalkDir::new(&root).follow_links(false).into_iter().filter_entry(|entry| !matches!(entry.file_name().to_str(), Some(".git" | ".snapshots" | "node_modules"))) {
        let entry = result.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() { continue; }
        let relative = entry.path().strip_prefix(&root).map_err(|error| error.to_string())?;
        let name = relative.to_string_lossy().replace('\\', "/");
        if name.starts_with(".snapshots/") || name == ".editor-config.json" || name == ".editor-config.json.corrupt" { continue; }
        buffer.clear();
        File::open(entry.path()).and_then(|mut file| file.read_to_end(&mut buffer)).map_err(|error| error.to_string())?;
        zip.start_file(name, options).map_err(|error| error.to_string())?;
        zip.write_all(&buffer).map_err(|error| error.to_string())?;
    }
    zip.finish().map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    let (_file, temporary_path) = temporary.keep().map_err(|error| error.to_string())?;
    Ok(atomic_replace(&temporary_path, &checked_destination)?)
}

#[tauri::command]
fn scan_orphan_assets(root: String) -> Result<Vec<String>, SaveError> {
    let root = canonical_root(&root)?;
    let assets = root.join("_assets");
    if !assets.exists() { return Ok(Vec::new()); }
    let image_link = Regex::new(r"!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))").map_err(|error| error.to_string())?;
    let image_reference = Regex::new(r"!\[([^\]]*)\]\[([^\]]*)\]").map_err(|error| error.to_string())?;
    let definition = Regex::new(r"(?m)^\s*\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))").map_err(|error| error.to_string())?;
    let mut referenced = HashSet::new();
    for entry in WalkDir::new(&root).follow_links(false).into_iter().filter_map(Result::ok).filter(|entry| entry.file_type().is_file() && is_markdown(entry.path())) {
        let bytes = match fs::read(entry.path()) { Ok(bytes) => bytes, Err(_) => continue };
        let source = match detect_and_decode(&bytes) { Ok((source, _)) => source, Err(_) => continue };
        let parent = entry.path().parent().unwrap_or(&root);
        for captures in image_link.captures_iter(&source) {
            let target = captures.get(1).or_else(|| captures.get(2)).map(|value| value.as_str()).unwrap_or("");
            if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("data:") { continue; }
            if let Ok(decoded) = percent_decode_str(target).decode_utf8() {
                if let Ok(path) = fs::canonicalize(parent.join(decoded.as_ref())) { referenced.insert(path); }
            }
        }
        let definitions: std::collections::HashMap<String, String> = definition.captures_iter(&source).filter_map(|captures| {
            let key = captures.get(1)?.as_str().to_ascii_lowercase();
            let value = captures.get(2).or_else(|| captures.get(3))?.as_str().to_string();
            Some((key, value))
        }).collect();
        for captures in image_reference.captures_iter(&source) {
            let label = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let reference = captures.get(2).map(|value| value.as_str()).unwrap_or("");
            let key = if reference.is_empty() { label } else { reference }.to_ascii_lowercase();
            if let Some(target) = definitions.get(&key) {
                if let Ok(decoded) = percent_decode_str(target).decode_utf8() {
                    if let Ok(path) = fs::canonicalize(parent.join(decoded.as_ref())) { referenced.insert(path); }
                }
            }
        }
    }
    let mut orphaned = Vec::new();
    for entry in WalkDir::new(&assets).follow_links(false).into_iter().filter_map(Result::ok).filter(|entry| entry.file_type().is_file()) {
        if let Ok(path) = fs::canonicalize(entry.path()) {
            if !referenced.contains(&path) { orphaned.push(path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/")); }
        }
    }
    orphaned.sort();
    Ok(orphaned)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            scan_workspace,
            read_markdown,
            write_markdown,
            create_entry,
            rename_entry,
            delete_entry,
            read_workspace_settings,
            write_workspace_settings,
            read_workspace_asset,
            watch_workspace,
            import_workspace,
            export_workspace,
            scan_orphan_assets,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") { window.set_title("Local MD")?; }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Local MD");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        assert!(validate_relative("../../secret.md").is_err());
        assert!(validate_relative("notes/ok.md").is_ok());
    }

    #[test]
    fn detects_dominant_line_ending() {
        assert_eq!(detect_eol("a\r\nb\r\n"), "crlf");
        assert_eq!(detect_eol("a\nb\n"), "lf");
        assert_eq!(detect_eol("a\rb\r"), "cr");
    }

    #[test]
    fn refuses_lossy_legacy_encoding() {
        let profile = FileFormatProfile { encoding: "big5".into(), bom: "none".into(), eol: "lf".into() };
        assert!(encode_content("emoji 😀", &profile).is_err());
    }

    #[test]
    fn serializes_save_conflicts_with_a_stable_kind() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.md");
        fs::write(&path, b"disk content\n").unwrap();
        let error = verify_expected(&path, &Some("stale-hash".into()), false).unwrap_err();
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["kind"], "Conflict");
        assert_eq!(value["expected"], "stale-hash");
        assert_eq!(value["actual"], hash_bytes(b"disk content\n"));
    }

    #[test]
    fn normalizes_incomplete_settings() {
        let directory = tempfile::tempdir().unwrap();
        let (settings, changed) = normalize_settings(directory.path(), &serde_json::json!({}));
        assert!(changed);
        assert_eq!(settings["settings"]["autoSaveDebounceMs"], 1500);
        assert_eq!(settings["settings"]["autoSaveEnabled"], true);
        assert!(settings["ui"]["openTabs"].is_array());
        assert_eq!(settings["ui"]["sidebarWidth"], 276);
        assert_eq!(settings["ui"]["propertiesWidth"], 288);
        assert!(settings["ui"]["tabGroups"].is_array());
        assert!(settings["ui"]["tabAssignments"].is_object());
    }

    #[test]
    fn rejects_asset_parent_escape() {
        assert!(normalized_asset_path("note.md", "../secret.png").is_err());
        assert_eq!(normalized_asset_path("notes/note.md", "../images/a.png").unwrap(), PathBuf::from("images/a.png"));
    }

    #[test]
    fn sniffs_supported_image_magic_bytes() {
        assert_eq!(sniff_image_mime(&[0x89, 0x50, 0x4e, 0x47]), Some("image/png"));
        assert_eq!(sniff_image_mime(&[0xff, 0xd8, 0xff]), Some("image/jpeg"));
        assert_eq!(sniff_image_mime(b"GIF89a"), Some("image/gif"));
        assert_eq!(sniff_image_mime(b"RIFF\x01\x00\x00\x00WEBP"), Some("image/webp"));
        assert_eq!(sniff_image_mime(b"BM"), Some("image/bmp"));
        assert_eq!(sniff_image_mime(b"RIFF"), None);
    }

    #[test]
    fn rejects_image_when_extension_and_magic_bytes_disagree() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("fake.png"), [0xff, 0xd8, 0xff, 0x00]).unwrap();
        assert!(read_workspace_asset(
            root.path().to_string_lossy().into(),
            "note.md".into(),
            "fake.png".into(),
        ).is_err());
    }

    #[test]
    fn rejects_oversized_markdown_before_reading_content() {
        let root = tempfile::tempdir().unwrap();
        File::create(root.path().join("large.md")).unwrap().set_len(MAX_MARKDOWN_BYTES + 1).unwrap();
        assert!(read_markdown(root.path().to_string_lossy().into(), "large.md".into()).is_err());
    }

    #[test]
    fn rejects_oversized_image_before_reading_content() {
        let root = tempfile::tempdir().unwrap();
        File::create(root.path().join("large.png")).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(read_workspace_asset(
            root.path().to_string_lossy().into(),
            "note.md".into(),
            "large.png".into(),
        ).is_err());
    }

    #[test]
    fn import_does_not_overwrite_collisions() {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        fs::write(source.path().join("same.md"), b"source\n").unwrap();
        fs::write(target.path().join("same.md"), b"target\n").unwrap();
        let report = import_workspace(source.path().to_string_lossy().into(), target.path().to_string_lossy().into()).unwrap();
        assert_eq!(report.failed, 1);
        assert_eq!(fs::read(target.path().join("same.md")).unwrap(), b"target\n");
    }

    #[test]
    fn export_rejects_destination_inside_workspace() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("note.md"), b"# note\n").unwrap();
        let destination = root.path().join("backup.zip");
        assert!(export_workspace(root.path().to_string_lossy().into(), destination.to_string_lossy().into()).is_err());
        assert!(!destination.exists());
    }
}
