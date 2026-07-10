//! rclone binary manager: spawning, versioned downloads, and PATH integration.
//!
//! rclone is executed by absolute path from here (via `std::process`), replacing the
//! old `tauri-plugin-shell` named-command approach that could only run two fixed paths.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Shared types & state
// ---------------------------------------------------------------------------

/// Result of a one-shot rclone invocation.
#[derive(Serialize)]
pub struct ExecResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Event streamed from the long-lived daemon to the frontend over a Channel.
/// Only `close` is emitted — stdout/stderr are discarded (nothing consumes them;
/// readiness is RC-port polling on the JS side).
#[derive(Serialize, Clone)]
pub struct RcloneEvent {
    pub kind: String, // "close"
    pub code: Option<i32>,
    pub intentional: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedVersion {
    pub version: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Serialize)]
pub struct RcloneClassification {
    pub kind: String, // "system" | "managed" | "custom"
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct PathStatus {
    pub enabled: bool,
    pub target: Option<String>,
    pub warning: Option<String>,
}

/// Tracks the currently-running daemon so kills can be marked intentional (suppressing
/// the crash dialog) and so a webview reload cannot orphan the process.
#[derive(Default)]
pub struct DaemonState {
    pid: Option<u32>,
    intentional: Option<Arc<AtomicBool>>,
}

pub type SharedDaemonState = Mutex<DaemonState>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "rclone.exe"
    } else {
        "rclone"
    }
}

fn app_local_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

fn versions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data(app)?.join("rclone-versions"))
}

/// Legacy single-slot binary path used before the versioned layout.
fn legacy_slot(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data(app)?.join(bin_name()))
}

/// Stable pointer used for PATH integration (independent of the active version).
fn path_pointer(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data(app)?.join("bin").join(bin_name()))
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn rclone_os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "osx",
        other => other,
    }
}

fn rclone_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        "i386" | "x86" => "386",
        _ => "unknown",
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ---------------------------------------------------------------------------
// One-shot execution
// ---------------------------------------------------------------------------

fn exec_blocking(
    path: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    stdin_lines: Option<Vec<String>>,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, String> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.stdin(if stdin_lines.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run {}: {}", path, e))?;

    // Feed stdin lines (paced) then close stdin.
    if let Some(lines) = stdin_lines {
        if let Some(mut stdin) = child.stdin.take() {
            for line in lines {
                let _ = stdin.write_all(line.as_bytes());
                let _ = stdin.write_all(b"\n");
                let _ = stdin.flush();
                std::thread::sleep(Duration::from_millis(100));
            }
            // stdin dropped here -> EOF
        }
    }

    // Drain stdout/stderr on threads so the pipes can't fill and deadlock the wait.
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(ref mut o) = out {
            let _ = o.read_to_string(&mut s);
        }
        s
    });
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(ref mut e) = err {
            let _ = e.read_to_string(&mut s);
        }
        s
    });

    let code = if let Some(t) = timeout_ms {
        let deadline = Instant::now() + Duration::from_millis(t);
        loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => break status.code(),
                None => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        break None; // timed out
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
            }
        }
    } else {
        child.wait().map_err(|e| e.to_string())?.code()
    };

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();

    Ok(ExecResult {
        code,
        stdout,
        stderr,
    })
}

#[tauri::command]
pub async fn exec_rclone(
    path: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    stdin_lines: Option<Vec<String>>,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        exec_blocking(path, args, env, stdin_lines, timeout_ms)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_rclone_version(stdout: &str) -> Option<String> {
    let first = stdout.lines().next()?;
    // e.g. "rclone v1.74.3" or "rclone v1.74.0-beta.9673.d0c469c3c"
    let token = first.split_whitespace().nth(1)?;
    Some(token.trim_start_matches('v').to_string())
}

/// Runs `<path> version`, returning the parsed version. Adds a Gatekeeper-specific hint on macOS.
#[tauri::command]
pub async fn validate_rclone_binary(path: String) -> Result<String, String> {
    let result = exec_blocking(
        path.clone(),
        vec!["version".to_string()],
        HashMap::new(),
        None,
        Some(5000),
    );

    match result {
        Ok(res) if res.code == Some(0) => parse_rclone_version(&res.stdout)
            .ok_or_else(|| "Could not parse rclone version output".to_string()),
        Ok(res) => {
            #[cfg(target_os = "macos")]
            {
                // Detect quarantine (Gatekeeper) which SIGKILLs unsigned binaries.
                let quarantined = std::process::Command::new("xattr")
                    .args(["-p", "com.apple.quarantine", &path])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if quarantined {
                    return Err(format!(
                        "macOS blocked this binary (Gatekeeper/quarantine). Run: xattr -d com.apple.quarantine \"{}\"",
                        path
                    ));
                }
            }
            let msg = res.stderr.trim();
            Err(if msg.is_empty() {
                format!("rclone exited with code {:?}", res.code)
            } else {
                msg.to_string()
            })
        }
        Err(e) => Err(e),
    }
}

/// Runs `<path> config paths` and returns the native config-file path.
#[tauri::command]
pub async fn rclone_config_path(path: String) -> Result<String, String> {
    let res = exec_blocking(
        path,
        vec!["config".to_string(), "paths".to_string()],
        HashMap::new(),
        None,
        Some(8000),
    )?;
    if res.code != Some(0) {
        return Err(format!("rclone config paths failed: {}", res.stderr.trim()));
    }
    for line in res.stdout.lines() {
        if let Some(rest) = line.strip_prefix("Config file:") {
            return Ok(rest.trim().to_string());
        }
    }
    Err("Could not find config file path in output".to_string())
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn spawn_rclone(
    app: AppHandle,
    path: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    on_event: tauri::ipc::Channel<RcloneEvent>,
) -> Result<u32, String> {
    use std::process::{Command, Stdio};

    // Reject a second daemon instead of orphaning the first. A restart that reaches here after a
    // swallowed kill failure gets the clean spawn-failure dialog rather than a crash dialog.
    {
        let state = app.state::<SharedDaemonState>();
        let s = state.lock().unwrap();
        if s.pid.is_some() {
            return Err("an rclone daemon is already running".to_string());
        }
    }

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    for (k, v) in &env {
        cmd.env(k, v);
    }
    // Nothing consumes daemon stdio; null it to avoid pipe-fill and extra threads.
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn rclone daemon: {}", e))?;
    let pid = child.id();

    let intentional = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<SharedDaemonState>();
        let mut s = state.lock().unwrap();
        s.pid = Some(pid);
        s.intentional = Some(intentional.clone());
    }

    let app_thread = app.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let was_intentional = intentional.load(Ordering::SeqCst);
        let code = status.ok().and_then(|s| s.code());

        // Clear state only if we are still the current daemon.
        {
            let state = app_thread.state::<SharedDaemonState>();
            let mut s = state.lock().unwrap();
            if s.pid == Some(pid) {
                s.pid = None;
                s.intentional = None;
            }
        }

        let _ = on_event.send(RcloneEvent {
            kind: "close".to_string(),
            code,
            intentional: was_intentional,
        });
    });

    Ok(pid)
}

/// Terminates the running daemon. Marks it intentional so its close event is ignored by the UI.
/// Returns whether a daemon was actually killed (false when nothing was tracked). Rust state is
/// authoritative — no caller-supplied pid to SIGKILL a possibly-reused OS pid.
#[tauri::command]
pub async fn kill_rclone_daemon(
    app: AppHandle,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    let target = {
        let state = app.state::<SharedDaemonState>();
        let s = state.lock().unwrap();
        if s.pid.is_some() {
            if let Some(flag) = &s.intentional {
                flag.store(true, Ordering::SeqCst);
            }
        }
        s.pid
    };

    if let Some(pid) = target {
        crate::kill_pid(pid, Some(timeout_ms.unwrap_or(5000))).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// System-rclone discovery & classification
// ---------------------------------------------------------------------------

/// Walks PATH for an rclone executable, skipping any candidate under the app data dir
/// (so our own PATH-integration pointer is never mistaken for a "system" install).
#[tauri::command]
pub fn find_system_rclone(app: AppHandle) -> Option<String> {
    let exe = bin_name();
    let path_var = std::env::var_os("PATH")?;
    let app_data = app_local_data(&app).ok().map(|p| canonical(&p));

    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if !candidate.is_file() {
            continue;
        }
        let canon = canonical(&candidate);
        if let Some(ad) = &app_data {
            if canon.starts_with(ad) {
                continue;
            }
        }
        return Some(candidate.to_string_lossy().to_string());
    }
    None
}

/// Classifies a path as system / managed / custom (with canonical comparisons, so case-insensitive
/// filesystems and symlinked PATH entries don't misclassify).
#[tauri::command]
pub fn classify_rclone_path(app: AppHandle, path: String) -> RcloneClassification {
    let canon = canonical(Path::new(&path));

    if let Ok(vdir) = versions_dir(&app) {
        let vdir_canon = canonical(&vdir);
        if canon.starts_with(&vdir_canon) {
            // .../rclone-versions/v1.74.3/rclone -> "1.74.3"
            let version = canon
                .strip_prefix(&vdir_canon)
                .ok()
                .and_then(|rest| rest.components().next())
                .map(|c| c.as_os_str().to_string_lossy().trim_start_matches('v').to_string());
            return RcloneClassification {
                kind: "managed".to_string(),
                version,
            };
        }
    }

    if let Some(sys) = find_system_rclone(app) {
        if canonical(Path::new(&sys)) == canon {
            return RcloneClassification {
                kind: "system".to_string(),
                version: None,
            };
        }
    }

    RcloneClassification {
        kind: "custom".to_string(),
        version: None,
    }
}

// ---------------------------------------------------------------------------
// Versioned library: list / delete / adopt / self-heal
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_downloaded_rclone_versions(app: AppHandle) -> Result<Vec<DownloadedVersion>, String> {
    let base = versions_dir(&app)?;
    let mut out = Vec::new();
    if !base.exists() {
        return Ok(out);
    }
    let entries = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with('v') || name.starts_with(".tmp") {
            continue;
        }
        let bin = entry.path().join(bin_name());
        if !bin.is_file() {
            continue;
        }
        let size = std::fs::metadata(&bin).map(|m| m.len()).unwrap_or(0);
        out.push(DownloadedVersion {
            version: name.trim_start_matches('v').to_string(),
            path: bin.to_string_lossy().to_string(),
            size_bytes: size,
        });
    }
    // Newest first.
    out.sort_by(|a, b| compare_versions(&b.version, &a.version));
    Ok(out)
}

/// Refuses to delete the version whose binary is the currently active one.
#[tauri::command]
pub fn delete_rclone_version(
    app: AppHandle,
    version: String,
    active_path: Option<String>,
) -> Result<(), String> {
    let dir = versions_dir(&app)?.join(format!("v{}", version));
    if !dir.exists() {
        return Ok(());
    }
    if let Some(active) = active_path {
        let active_canon = canonical(Path::new(&active));
        if active_canon.starts_with(canonical(&dir)) {
            return Err("Cannot delete the active rclone version".to_string());
        }
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

/// Moves a pre-existing single-slot `$APPLOCALDATA/rclone` binary into the versioned library.
#[tauri::command]
pub async fn adopt_legacy_rclone(app: AppHandle) -> Result<Option<DownloadedVersion>, String> {
    let legacy = legacy_slot(&app)?;
    if !legacy.is_file() {
        return Ok(None);
    }

    let version = validate_rclone_binary(legacy.to_string_lossy().to_string())
        .await
        .map_err(|e| format!("Failed to probe legacy rclone: {}", e))?;

    let dest_dir = versions_dir(&app)?.join(format!("v{}", version));
    let dest = dest_dir.join(bin_name());
    if !dest.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        // Same volume -> rename; fall back to copy+remove.
        if std::fs::rename(&legacy, &dest).is_err() {
            std::fs::copy(&legacy, &dest).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&legacy);
        }
        set_executable(&dest);
    }

    let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(Some(DownloadedVersion {
        version,
        path: dest.to_string_lossy().to_string(),
        size_bytes: size,
    }))
}

/// Returns the on-disk path for a managed version if present (used to self-heal a stale
/// absolute `rclonePath` after a home-dir move/rename before falling down the ladder).
#[tauri::command]
pub fn managed_version_path(app: AppHandle, version: String) -> Option<String> {
    let bin = versions_dir(&app)
        .ok()?
        .join(format!("v{}", version))
        .join(bin_name());
    if bin.is_file() {
        Some(bin.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Removes stale `.tmp-*` staging dirs from an interrupted download. Called once at startup
/// (before any webview) so it can never race a live download; failures are non-fatal.
pub fn sweep_versions_tmp(app: &AppHandle) {
    let Ok(base) = versions_dir(app) else {
        return;
    };
    if !base.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(".tmp") {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(v: &str) -> (u64, u64, u64) {
        // Strip any leading 'v' and drop a pre-release suffix (e.g. "1.74.0-beta.x").
        let core = v.trim_start_matches('v');
        let core = core.split('-').next().unwrap_or(core);
        let mut it = core.split('.').map(|n| n.parse::<u64>().unwrap_or(0));
        (
            it.next().unwrap_or(0),
            it.next().unwrap_or(0),
            it.next().unwrap_or(0),
        )
    }
    parts(a).cmp(&parts(b))
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    version: String,
    downloaded: u64,
    total: Option<u64>,
}

fn build_http_client(proxy_url: Option<String>) -> Result<reqwest::Client, String> {
    use std::time::Duration;
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(600));
    if let Some(p) = proxy_url {
        let p = p.trim().to_string();
        if !p.is_empty() {
            let proxy = reqwest::Proxy::all(&p).map_err(|e| format!("Invalid proxy: {}", e))?;
            builder = builder.proxy(proxy);
        }
    }
    builder.build().map_err(|e| e.to_string())
}

/// Parses a (PGP-signed) SHA256SUMS body for the expected hash of `file_name`.
fn expected_sha256(sums: &str, file_name: &str) -> Option<String> {
    // SHA256SUMS is PGP-signed: skip the header/footer and blank lines, match "<hash>  <file>".
    for line in sums.lines() {
        let mut it = line.split_whitespace();
        let Some(hash) = it.next() else {
            continue;
        };
        let name = it.last().unwrap_or("");
        if name == file_name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

#[tauri::command]
pub async fn download_rclone_version(
    app: AppHandle,
    version: String,
    proxy_url: Option<String>,
) -> Result<String, String> {
    let arch = rclone_arch();
    if arch == "unknown" {
        return Err("Unsupported architecture".to_string());
    }
    let os = rclone_os();
    let zip_name = format!("rclone-v{}-{}-{}.zip", version, os, arch);
    let zip_url = format!("https://downloads.rclone.org/v{}/{}", version, zip_name);
    let sums_url = format!("https://downloads.rclone.org/v{}/SHA256SUMS", version);

    let base = versions_dir(&app)?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let tmp = base.join(format!(".tmp-{}", version));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    // Wrap the work so we always clean up the tmp dir on failure.
    let result =
        download_and_install(&app, &version, &zip_name, &zip_url, &sums_url, proxy_url, &tmp, &base)
            .await;
    let _ = std::fs::remove_dir_all(&tmp);

    let installed_path = result?;

    let _ = app.emit(
        "rclone-download-finished",
        DownloadProgress {
            version,
            downloaded: 0,
            total: None,
        },
    );
    Ok(installed_path)
}

async fn download_and_install(
    app: &AppHandle,
    version: &str,
    zip_name: &str,
    zip_url: &str,
    sums_url: &str,
    proxy_url: Option<String>,
    tmp: &Path,
    base: &Path,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;

    let client = build_http_client(proxy_url)?;

    // 1. Expected checksum (hard requirement).
    let sums = client
        .get(sums_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch checksums: {}", e))?;
    if !sums.status().is_success() {
        return Err(format!("Checksums unavailable (HTTP {})", sums.status()));
    }
    let sums_body = sums.text().await.map_err(|e| e.to_string())?;
    let expected = expected_sha256(&sums_body, zip_name)
        .ok_or_else(|| format!("No checksum found for {}", zip_name))?;

    // 2. Stream the zip to disk while hashing + reporting progress.
    let zip_path = tmp.join("dl.zip");
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();

    let mut resp = client
        .get(zip_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed (HTTP {})", resp.status()));
    }
    let total = resp.content_length();
    let mut downloaded: u64 = 0;
    let mut since_emit: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        since_emit += chunk.len() as u64;
        if since_emit >= 262_144 {
            since_emit = 0;
            let _ = app.emit(
                "rclone-download-progress",
                DownloadProgress {
                    version: version.to_string(),
                    downloaded,
                    total,
                },
            );
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(format!(
            "Checksum mismatch for {} (expected {}, got {})",
            zip_name, expected, actual
        ));
    }

    // 3. Extract (zip-slip hardened) and locate the binary.
    let extract_dir = tmp.join("x");
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    unzip_hardened(&zip_path, &extract_dir)?;

    let binary = find_binary(&extract_dir)
        .ok_or_else(|| "rclone binary not found in archive".to_string())?;
    set_executable(&binary);

    // 4. Atomically publish into rclone-versions/v{version}/.
    let staging = tmp.join(format!("v{}", version));
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let staged_bin = staging.join(bin_name());
    std::fs::rename(&binary, &staged_bin)
        .or_else(|_| std::fs::copy(&binary, &staged_bin).map(|_| ()))
        .map_err(|e| e.to_string())?;
    set_executable(&staged_bin);

    let dest = base.join(format!("v{}", version));
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&staging, &dest).map_err(|e| e.to_string())?;

    Ok(dest.join(bin_name()).to_string_lossy().to_string())
}

fn find_binary(dir: &Path) -> Option<PathBuf> {
    let target = bin_name();
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_binary(&path) {
                return Some(found);
            }
        } else if entry.file_name().to_string_lossy() == target {
            return Some(path);
        }
    }
    None
}

fn unzip_hardened(zip_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let out_canon = canonical(out_dir);

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // Reject absolute paths / traversal.
        let name = entry
            .enclosed_name()
            .ok_or_else(|| "Unsafe path in archive".to_string())?;
        let outpath = out_dir.join(&name);

        if entry.name().ends_with('/') || entry.name().ends_with('\\') {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Defence in depth: ensure the resolved parent stays inside out_dir.
        if let Some(parent) = outpath.parent() {
            if !canonical(parent).starts_with(&out_canon) {
                return Err("Archive entry escapes output directory".to_string());
            }
        }
        let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// PATH integration
// ---------------------------------------------------------------------------

/// Refreshes the stable PATH pointer to aim at `target_path` (symlink on unix, copy on windows).
#[tauri::command]
pub fn update_path_pointer(app: AppHandle, target_path: String) -> Result<(), String> {
    let pointer = path_pointer(&app)?;
    if let Some(parent) = pointer.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let _ = std::fs::remove_file(&pointer);
        symlink(Path::new(&target_path), &pointer).map_err(|e| e.to_string())?;
    }

    #[cfg(windows)]
    {
        // Copy (Windows can't reliably symlink without privilege). Retry for transient locks.
        let mut last_err = None;
        for _ in 0..3 {
            match std::fs::copy(&target_path, &pointer) {
                Ok(_) => {
                    last_err = None;
                    break;
                }
                Err(e) => {
                    last_err = Some(e.to_string());
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
        if let Some(e) = last_err {
            return Err(format!(
                "Failed to update PATH pointer (close terminals using rclone and retry): {}",
                e
            ));
        }
    }

    Ok(())
}

/// True if the effective PATH resolves `rclone` to something other than our pointer.
fn path_shadow_warning(app: &AppHandle) -> Option<String> {
    let pointer_canon = path_pointer(app).ok().map(|p| canonical(&p))?;
    let exe = bin_name();
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            let canon = canonical(&candidate);
            if canon == pointer_canon {
                return None; // ours wins
            }
            return Some(format!(
                "Another rclone at {} takes precedence in your shell; the app's binary won't be used there.",
                candidate.to_string_lossy()
            ));
        }
    }
    None
}

#[cfg(target_os = "macos")]
const MACOS_LINK: &str = "/usr/local/bin/rclone";

#[tauri::command]
pub fn get_rclone_path_integration(app: AppHandle) -> Result<PathStatus, String> {
    let pointer = path_pointer(&app)?;
    let pointer_canon = canonical(&pointer);

    #[cfg(target_os = "macos")]
    {
        let link = Path::new(MACOS_LINK);
        let enabled = std::fs::read_link(link)
            .map(|t| canonical(&t) == pointer_canon)
            .unwrap_or(false);
        return Ok(PathStatus {
            enabled,
            target: Some(MACOS_LINK.to_string()),
            warning: if enabled { path_shadow_warning(&app) } else { None },
        });
    }

    #[cfg(target_os = "linux")]
    {
        let link = linux_link()?;
        let enabled = std::fs::read_link(&link)
            .map(|t| canonical(&t) == pointer_canon)
            .unwrap_or(false);
        let mut warning = if enabled { path_shadow_warning(&app) } else { None };
        if enabled && warning.is_none() && !dir_on_path(link.parent()) {
            warning = Some(format!(
                "{} is not on your PATH; add it or open a new login shell.",
                link.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
            ));
        }
        return Ok(PathStatus {
            enabled,
            target: Some(link.to_string_lossy().to_string()),
            warning,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let bin_dir = pointer.parent().map(|p| p.to_string_lossy().to_string());
        let enabled = bin_dir
            .as_ref()
            .map(|d| windows_path_contains(d))
            .unwrap_or(false);
        return Ok(PathStatus {
            enabled,
            target: bin_dir,
            warning: if enabled { path_shadow_warning(&app) } else { None },
        });
    }

    #[allow(unreachable_code)]
    Ok(PathStatus {
        enabled: false,
        target: None,
        warning: None,
    })
}

#[tauri::command]
pub fn set_rclone_path_integration(
    app: AppHandle,
    enable: bool,
    target_path: String,
) -> Result<PathStatus, String> {
    // Keep the pointer fresh before wiring anything to it.
    update_path_pointer(app.clone(), target_path)?;
    let pointer = path_pointer(&app)?;
    let pointer_str = pointer.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        macos_set_link(enable, &pointer_str)?;
    }

    #[cfg(target_os = "linux")]
    {
        linux_set_link(enable, &pointer)?;
    }

    #[cfg(target_os = "windows")]
    {
        let bin_dir = pointer
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "Invalid pointer path".to_string())?;
        windows_set_path(enable, &bin_dir)?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (enable, pointer_str);
        return Err("PATH integration not supported on this platform".to_string());
    }

    get_rclone_path_integration(app)
}

// ---- macOS PATH helpers ----

#[cfg(target_os = "macos")]
fn macos_set_link(enable: bool, pointer: &str) -> Result<(), String> {
    let link = Path::new(MACOS_LINK);

    if enable {
        // Never clobber a foreign rclone (e.g. Homebrew).
        if link.exists() {
            let ours = std::fs::read_link(link)
                .map(|t| canonical(&t) == canonical(Path::new(pointer)))
                .unwrap_or(false);
            if !ours {
                return Err(format!(
                    "An rclone already exists at {}. Remove it first to let Rclone UI manage it.",
                    MACOS_LINK
                ));
            }
            return Ok(()); // already ours
        }
        let cmd = format!("mkdir -p /usr/local/bin && ln -sfn {} {}", sh_quote(pointer), sh_quote(MACOS_LINK));
        run_osascript_admin(&cmd, "Rclone UI wants to add rclone to your PATH.")
    } else {
        // Only remove if it is our symlink.
        let ours = std::fs::read_link(link)
            .map(|t| canonical(&t) == canonical(Path::new(pointer)))
            .unwrap_or(false);
        if !ours {
            return Ok(());
        }
        let cmd = format!("rm -f {}", sh_quote(MACOS_LINK));
        run_osascript_admin(&cmd, "Rclone UI wants to remove rclone from your PATH.")
    }
}

/// POSIX single-quote a value for embedding in a shell command.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn run_osascript_admin(shell_cmd: &str, prompt: &str) -> Result<(), String> {
    // Escape for embedding inside an AppleScript string literal.
    let applescript_cmd = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "do shell script \"{}\" with administrator privileges with prompt \"{}\"",
        applescript_cmd,
        prompt.replace('"', "\\\"")
    );
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Authorization was cancelled or failed.".to_string())
    }
}

// ---- Linux PATH helpers ----

#[cfg(target_os = "linux")]
fn linux_link() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".local").join("bin").join("rclone"))
}

#[cfg(target_os = "linux")]
fn linux_set_link(enable: bool, pointer: &Path) -> Result<(), String> {
    use std::os::unix::fs::symlink;
    let link = linux_link()?;
    if enable {
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // symlink_metadata (unlike exists()) is also true for a broken symlink, so a dead link
        // no longer falls through to symlink() and fails EEXIST ("File exists") forever.
        if std::fs::symlink_metadata(&link).is_ok() {
            let target = std::fs::read_link(&link).ok();
            let ours = target
                .as_ref()
                .map(|t| canonical(t) == canonical(pointer))
                .unwrap_or(false);
            if ours {
                return Ok(());
            }
            // A dead symlink (its target no longer exists) is safe to replace; a live foreign
            // entry or a real file is not.
            let dead = target
                .as_ref()
                .map(|t| {
                    let resolved = if t.is_absolute() {
                        t.clone()
                    } else {
                        link.parent().map(|p| p.join(t)).unwrap_or_else(|| t.clone())
                    };
                    !resolved.exists()
                })
                .unwrap_or(false);
            if !dead {
                return Err(format!(
                    "An rclone already exists at {}. Remove it first.",
                    link.to_string_lossy()
                ));
            }
            let _ = std::fs::remove_file(&link);
        }
        symlink(pointer, &link).map_err(|e| e.to_string())
    } else {
        let ours = std::fs::read_link(&link)
            .map(|t| canonical(&t) == canonical(pointer))
            .unwrap_or(false);
        // Also clear a dangling symlink regardless of ownership — otherwise it silently blocks
        // re-enabling PATH integration until a manual rm.
        let broken = std::fs::symlink_metadata(&link).is_ok() && !link.exists();
        if ours || broken {
            let _ = std::fs::remove_file(&link);
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn dir_on_path(dir: Option<&Path>) -> bool {
    let Some(dir) = dir else { return false };
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };
    let dir_canon = canonical(dir);
    std::env::split_paths(&path_var).any(|p| canonical(&p) == dir_canon)
}

// ---- Windows PATH helpers ----

#[cfg(target_os = "windows")]
fn windows_path_contains(dir: &str) -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env = match hkcu.open_subkey("Environment") {
        Ok(k) => k,
        Err(_) => return false,
    };
    let current: String = env.get_value("Path").unwrap_or_default();
    let dir_lc = dir.to_ascii_lowercase();
    current
        .split(';')
        .any(|seg| seg.trim().trim_end_matches('\\').to_ascii_lowercase() == dir_lc.trim_end_matches('\\'))
}

#[cfg(target_os = "windows")]
fn windows_set_path(enable: bool, dir: &str) -> Result<(), String> {
    use winreg::enums::{RegType, HKEY_CURRENT_USER};
    use winreg::{RegKey, RegValue};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env, _) = hkcu
        .create_subkey("Environment")
        .map_err(|e| e.to_string())?;
    let current: String = env.get_value("Path").unwrap_or_default();

    let dir_norm = dir.trim_end_matches('\\').to_ascii_lowercase();
    let mut segments: Vec<String> = current
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    let already = segments
        .iter()
        .any(|s| s.trim_end_matches('\\').to_ascii_lowercase() == dir_norm);

    if enable {
        if !already {
            segments.push(dir.to_string());
        }
    } else {
        segments.retain(|s| s.trim_end_matches('\\').to_ascii_lowercase() != dir_norm);
    }

    let new_value = segments.join(";");
    // Preserve REG_EXPAND_SZ (PATH commonly contains %USERPROFILE% etc.).
    let bytes: Vec<u8> = new_value
        .encode_utf16()
        .chain(std::iter::once(0u16))
        .flat_map(|u| u.to_le_bytes())
        .collect();
    env.set_raw_value(
        "Path",
        &RegValue {
            bytes,
            vtype: RegType::REG_EXPAND_SZ,
        },
    )
    .map_err(|e| e.to_string())?;

    windows_broadcast_env_change();
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_broadcast_env_change() {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let param: Vec<u16> = std::ffi::OsStr::new("Environment")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut result: usize = 0;
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            param.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            &mut result,
        );
    }
}
