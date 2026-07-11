//! OS-native scheduling for Rclone UI's scheduled tasks.
//!
//! The GUI registers each task with the platform scheduler (the user's crontab on macOS/Linux,
//! Task Scheduler on Windows); the OS invokes this same binary headlessly (`run-task <id>`),
//! which executes the pre-serialized rclone requests stored in the task's job file. Whether a
//! task runs while logged out depends on its run mode: "user" (the default) only fires while the
//! user is logged in; "system" fires whether or not the user is logged in (cron daemon / S4U).
//!
//! Under Flatpak, scheduling works only when the user has granted host-spawn access
//! (`--talk-name=org.freedesktop.Flatpak`): the crontab commands run on the host via
//! `flatpak-spawn --host`, and the cron entry re-launches the app with `flatpak run … run-task`.

pub mod cronconv;
pub mod history;
pub mod jobfile;
pub mod runner;
pub mod storeread;

#[cfg(unix)]
mod crontab;
#[cfg(target_os = "macos")]
mod launchd;
#[cfg(target_os = "windows")]
mod schtasks;
#[cfg(target_os = "windows")]
mod winjob;

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

use jobfile::JobSpec;
use storeread::AppDirs;

/// The one cross-backend error sentinel: `set_enabled` on a task with no OS artifact. The
/// disable path in `scheduler_set_enabled` treats it as benign (nothing armed IS disabled), so
/// every backend must return exactly this — schtasks in particular can't rely on its localized
/// /Change stderr and prechecks with its locale-invariant query instead.
pub(crate) const NOT_REGISTERED: &str = "Task is not registered";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallState {
    NotInstalled,
    Installed { enabled: bool },
}

/// Everything a backend needs to (re)create the OS artifact for a task.
pub struct RenderedSchedule {
    pub cron: cronconv::CronSpec,
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The task's friendly name. Only the Windows backend has somewhere to put it (the schtasks
    /// XML `<Description>`); launchd identifies by Label = task id and crontab by a marker comment,
    /// so neither reads it — hence the cfg-gated allow.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub display_name: String,
    /// User-mode task (the default): only runs while the user is logged in. Only the Windows
    /// backend reads this — it bakes the mode into a single artifact (InteractiveToken vs S4U).
    /// On macOS the mode already picked the backend (launchd vs crontab) before rendering, and on
    /// Linux the crontab entry is identical for both modes (the runner gates/borrows the session
    /// at fire time from the job file). Hence the cfg-gated allow off Windows.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub user_mode: bool,
    /// The state to install in. Baked into the artifact (crontab `#off#` prefix, launchd
    /// active-vs-parked location, schtasks Settings `<Enabled>`) so registration is one
    /// operation: a disabled task is never briefly armed between an install and a follow-up
    /// set_enabled, and a partial failure can't leave it running against the user's intent.
    pub enabled: bool,
    /// The task's max run time. Only the Windows backend reads it (schtasks
    /// `<ExecutionTimeLimit>` must sit above the runner's own deadline or Task Scheduler kills
    /// the run first); cron/launchd don't supervise run durations — the runner's deadline is the
    /// only limit there.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub max_run_seconds: u64,
}

pub trait SchedulerBackend: Send + Sync {
    /// Create or overwrite the OS artifact in `rendered.enabled`'s state. Idempotent.
    fn install(&self, task_id: &str, rendered: &RenderedSchedule) -> Result<(), String>;
    /// Remove the OS artifact. Idempotent (missing artifacts are not an error).
    fn uninstall(&self, task_id: &str) -> Result<(), String>;
    fn set_enabled(&self, task_id: &str, enabled: bool) -> Result<(), String>;
    fn run_now(&self, task_id: &str) -> Result<(), String>;
    fn is_installed(&self, task_id: &str) -> Result<InstallState, String>;
    /// A user-visible reason the task won't fire even though it is installed and enabled —
    /// state the backend's own enabled model cannot see (macOS: the background item toggled off
    /// in System Settings unloads the agent while the plist stays in LaunchAgents). None = healthy.
    fn health_warning(&self, _task_id: &str) -> Option<String> {
        None
    }
}

/// The mode-agnostic / default backend (crontab on Unix, schtasks on Windows). Used where the run
/// mode is irrelevant — `scheduler_supported`, and the runner's orphan self-heal. On macOS this is
/// the SYSTEM-mode backend; user-mode tasks go through launchd via `backend_for`.
pub fn backend(dirs: &AppDirs) -> Result<Box<dyn SchedulerBackend>, String> {
    // No Flatpak permission check here: the startup gate (has_flatpak_permissions) quits the app
    // unless both host filesystem and host-spawn access are granted, so any running instance can
    // schedule. Only the "is cron installed on the host" capability is checked below.
    #[cfg(unix)]
    {
        crontab::check_available()?;
        Ok(Box::new(crontab::CrontabBackend::new(dirs)))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(Box::new(schtasks::SchtasksBackend::new(dirs)))
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = dirs;
        Err("Scheduling is not supported on this platform".to_string())
    }
}

/// The backend for a task given its run mode. Only macOS splits by mode: user-mode → launchd
/// LaunchAgent (login-session context), system-mode → crontab. Linux uses crontab for both modes
/// (the runner gates/borrows the session at fire time); Windows uses schtasks for both (the logon
/// type differs inside the task XML).
pub fn backend_for(dirs: &AppDirs, user_mode: bool) -> Result<Box<dyn SchedulerBackend>, String> {
    #[cfg(target_os = "macos")]
    {
        if user_mode {
            return Ok(Box::new(launchd::LaunchdBackend::new(dirs)));
        }
        crontab::check_available()?;
        Ok(Box::new(crontab::CrontabBackend::new(dirs)))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = user_mode;
        backend(dirs)
    }
}

/// Backends OTHER than the one selected for `user_mode` — the artifacts a mode flip must clean up
/// so a task never fires from two backends. Only macOS has a second backend; empty elsewhere.
/// Errors (crontab unavailable) PROPAGATE: silently skipping the cleanup would let a flip
/// install the new backend while the old one keeps firing.
fn other_backends(dirs: &AppDirs, user_mode: bool) -> Result<Vec<Box<dyn SchedulerBackend>>, String> {
    #[cfg(target_os = "macos")]
    {
        let other: Box<dyn SchedulerBackend> = if user_mode {
            crontab::check_available()?;
            Box::new(crontab::CrontabBackend::new(dirs))
        } else {
            Box::new(launchd::LaunchdBackend::new(dirs))
        };
        Ok(vec![other])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (dirs, user_mode);
        Ok(Vec::new())
    }
}

/// Serializes every scheduler mutation across the process. The hidden main window's startup
/// reconcile and an edit from the Settings webview otherwise interleave their whole-crontab
/// read-modify-write and silently drop each other's entry (healed only at the next reconcile).
/// The runner process is covered separately by the crontab file lock (crontab.rs).
static MUTATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn mutation_guard() -> std::sync::MutexGuard<'static, ()> {
    MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Every backend a task could be registered in — used for mode-agnostic teardown (unregister,
/// orphan sweep) that must cover both macOS backends.
fn all_backends(dirs: &AppDirs) -> Vec<Box<dyn SchedulerBackend>> {
    let mut backends: Vec<Box<dyn SchedulerBackend>> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        if crontab::check_available().is_ok() {
            backends.push(Box::new(crontab::CrontabBackend::new(dirs)));
        }
        backends.push(Box::new(launchd::LaunchdBackend::new(dirs)));
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(b) = backend(dirs) {
            backends.push(b);
        }
    }
    backends
}

/// The Flatpak application id (from FLATPAK_ID inside the sandbox; the manifest id otherwise).
fn flatpak_app_id() -> String {
    std::env::var("FLATPAK_ID").unwrap_or_else(|_| "com.rcloneui.RcloneUI".to_string())
}

/// Task ids become crontab markers, schtasks task names, and file names — never trust them,
/// even though the app generates UUIDs.
pub fn sanitize_id(task_id: &str) -> Result<String, String> {
    if task_id.is_empty() || task_id.len() > 64 {
        return Err("invalid task id".to_string());
    }
    if !task_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        || task_id.contains("..")
    {
        return Err("invalid task id".to_string());
    }
    Ok(task_id.to_string())
}

/// The path the OS scheduler should invoke — stable across app restarts and updates.
pub fn registered_invocation() -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        // AppImage: current_exe() is the transient /tmp/.mount_* path; $APPIMAGE is the real file.
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            return Ok(PathBuf::from(appimage));
        }
    }

    let exe = std::env::current_exe().map_err(|e| format!("cannot resolve app path: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        if exe.to_string_lossy().contains("/AppTranslocation/") {
            return Err(
                "Move Rclone UI to the Applications folder before scheduling tasks".to_string(),
            );
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Snap (classic): pin to the 'current' symlink so registrations survive refreshes.
        let text = exe.to_string_lossy().to_string();
        if let Some(rest) = text.strip_prefix("/snap/") {
            let mut parts = rest.splitn(3, '/');
            if let (Some(name), Some(_rev), Some(tail)) = (parts.next(), parts.next(), parts.next())
            {
                return Ok(PathBuf::from(format!("/snap/{}/current/{}", name, tail)));
            }
        }
    }

    Ok(exe)
}

fn render(dirs: &AppDirs, spec: &JobSpec, enabled: bool) -> Result<RenderedSchedule, String> {
    let cron = cronconv::parse(&spec.cron)?;

    // Under Flatpak the host scheduler can't invoke the sandbox binary directly — it re-launches
    // the app via `flatpak run <id> …`, which forwards the trailing args to our headless mode.
    let mut args = Vec::new();
    let program = if crate::is_flatpak() {
        args.push("run".to_string());
        args.push(flatpak_app_id());
        PathBuf::from("flatpak")
    } else {
        registered_invocation()?
    };
    args.extend([
        "run-task".to_string(),
        spec.task_id.clone(),
        "--host".to_string(),
        spec.host_id.clone(),
        // Bake the GUI's resolved data roots into the invocation: schedulers hand the runner a
        // bare environment, so re-deriving them there silently diverges when the session sets
        // XDG_DATA_HOME (Linux) — the runner would look in ~/.local/share, find no job file,
        // and treat a valid task as an orphan.
        "--data-dir".to_string(),
        dirs.app_data.to_string_lossy().into_owned(),
        "--local-data-dir".to_string(),
        dirs.app_local_data.to_string_lossy().into_owned(),
    ]);

    Ok(RenderedSchedule {
        cron,
        program,
        args,
        display_name: spec.name.clone(),
        user_mode: spec.is_user_mode(),
        enabled,
        max_run_seconds: spec.max_run_seconds,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportInfo {
    pub supported: bool,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn scheduler_supported(app: AppHandle) -> SupportInfo {
    // spawn_blocking: on Flatpak, backend()→check_available() probes the host with a subprocess.
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = match storeread::app_dirs_from(&app) {
            Ok(d) => d,
            Err(e) => {
                return SupportInfo {
                    supported: false,
                    reason: Some(e),
                }
            }
        };
        match backend(&dirs) {
            Ok(_) => SupportInfo {
                supported: true,
                reason: None,
            },
            Err(reason) => SupportInfo {
                supported: false,
                reason: Some(reason),
            },
        }
    })
    .await
    .unwrap_or(SupportInfo {
        supported: false,
        reason: Some("scheduler availability check failed".to_string()),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronValidation {
    pub valid: bool,
    pub error: Option<String>,
    /// The next few local fire times (RFC3339 with offset), computed by the SAME matcher the
    /// runner uses. This is the UI's preview source — JS cron libraries disagree with Vixie
    /// cron on the dom/dow star flag, so predicting fires anywhere else risks showing runs the
    /// native schedule will never perform. Empty when invalid (or nothing fires within 5 years).
    pub next_runs: Vec<String>,
}

#[tauri::command]
pub fn scheduler_validate_cron(cron: String) -> CronValidation {
    match cronconv::validate_for_current_platform(&cron) {
        Ok(()) => CronValidation {
            valid: true,
            error: None,
            next_runs: cronconv::parse(&cron)
                .map(|spec| cronconv::next_fires(&spec, chrono::Local::now(), 5))
                .unwrap_or_default(),
        },
        Err(error) => CronValidation {
            valid: false,
            error: Some(error),
            next_runs: Vec::new(),
        },
    }
}

/// UPSERT: write the job file and (re)install the OS artifact in the given enabled state (one
/// operation — no separate set_enabled step to half-fail). The backend depends on the run mode
/// (macOS user → launchd, else crontab/schtasks); a mode flip first uninstalls the old artifact
/// from the other backend so the task never fires twice.
#[tauri::command]
pub async fn scheduler_register(app: AppHandle, spec: JobSpec, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;

        sanitize_id(&spec.task_id)?;
        sanitize_id(&spec.host_id)?;
        if spec.schema_version != jobfile::JOB_SCHEMA_VERSION {
            return Err(format!(
                "unsupported job schema version {}",
                spec.schema_version
            ));
        }
        if spec.host_id != "local" {
            return Err("Scheduling is only supported for the local host".to_string());
        }
        if spec.requests.is_empty() {
            return Err("The task produced no rclone requests".to_string());
        }

        // Linux 'User' mode is gated at fire time on logind session state — a system without
        // systemd-logind/elogind can never pass that gate, so every fire would silently skip.
        // Registration happens from the GUI, i.e. while the user IS logged in: failing the gate
        // right now proves it can never pass, and the error can name the fix.
        #[cfg(target_os = "linux")]
        {
            if spec.is_user_mode() && !runner::user_has_login_session() {
                return Err(
                    "This system does not report login sessions (systemd-logind or elogind is required for the 'User' run mode to know when you are logged in). Switch this schedule's run mode to 'System', which runs regardless of login state."
                        .to_string(),
                );
            }
        }

        let _guard = mutation_guard();
        let user_mode = spec.is_user_mode();
        let backend = backend_for(&dirs, user_mode)?;
        let rendered = render(&dirs, &spec, enabled)?;
        // Remove any artifact left in the other backend (a user↔system flip on macOS) BEFORE the
        // job file changes. Order matters: if this cleanup fails after the job file already says
        // the NEW mode, the old backend's still-firing trigger would run under the new mode's
        // contract — on macOS a cron fire would be trusted as launchd-in-session and skip every
        // gate. Failing here leaves old trigger + old job file: consistent old behavior.
        for other in other_backends(&dirs, user_mode)? {
            other.uninstall(&spec.task_id).map_err(|e| {
                format!("failed to remove the task's previous registration: {}", e)
            })?;
        }
        jobfile::save(&dirs, &spec)?;
        if let Err(e) = backend.install(&spec.task_id, &rendered) {
            // Keep the reported state truthful: "not registered" must mean nothing fires. The
            // old artifact would otherwise keep firing the OLD schedule against the NEW job
            // file. The job file stays for the startup reconcile to retry.
            let _ = backend.uninstall(&spec.task_id);
            return Err(e);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scheduler_unregister(
    app: AppHandle,
    task_id: String,
    host_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let task_id = sanitize_id(&task_id)?;
        let host_id = sanitize_id(&host_id)?;
        let _guard = mutation_guard();
        // Uninstall from every backend (macOS covers both launchd and crontab) so the task is
        // removed regardless of the mode it was registered under. The job file is removed even
        // when an OS-level uninstall fails: a surviving trigger self-heals on its next fire (the
        // runner finds no job file, removes the trigger, and exits).
        let mut uninstall_result = Ok(());
        for backend in all_backends(&dirs) {
            if let Err(e) = backend.uninstall(&task_id) {
                uninstall_result = Err(e);
            }
        }
        jobfile::remove(&dirs, &host_id, &task_id);
        history::remove_all(&dirs, &task_id);
        uninstall_result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scheduler_set_enabled(
    app: AppHandle,
    task_id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let task_id = sanitize_id(&task_id)?;
        let _guard = mutation_guard();
        // Load the spec to pick the backend the task is actually registered in (macOS user vs
        // system live in different backends).
        let user_mode = jobfile::load(&dirs, "local", &task_id)
            .map(|spec| spec.is_user_mode())
            .unwrap_or(true);
        let result = backend_for(&dirs, user_mode)?.set_enabled(&task_id, enabled);

        // Disabling must reach whatever artifact actually exists. After a failed registration
        // or mode flip the artifact can live in the OTHER backend (or nowhere): try every
        // backend, treat "no artifact anywhere" as success (nothing armed IS disabled), but
        // never swallow a real failure — that would leave the task firing while the UI says
        // paused. Enabling keeps the strict single-backend error: it must not guess.
        if !enabled {
            let mut real_error = match result {
                Ok(()) => return Ok(()),
                Err(e) if e == NOT_REGISTERED => None,
                Err(e) => Some(e),
            };
            for backend in all_backends(&dirs) {
                match backend.set_enabled(&task_id, false) {
                    Ok(()) => return Ok(()),
                    Err(e) if e == NOT_REGISTERED => {}
                    Err(e) => {
                        real_error.get_or_insert(e);
                    }
                }
            }
            return match real_error {
                Some(e) => Err(e),
                None => Ok(()),
            };
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scheduler_run_now(app: AppHandle, task_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let task_id = sanitize_id(&task_id)?;
        let user_mode = jobfile::load(&dirs, "local", &task_id)
            .map(|spec| spec.is_user_mode())
            .unwrap_or(true);
        backend_for(&dirs, user_mode)?.run_now(&task_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatus {
    pub task_id: String,
    pub installed: bool,
    pub enabled: bool,
    pub running: bool,
    pub last_finished: Option<serde_json::Value>,
    /// Backend health warning (see `SchedulerBackend::health_warning`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn scheduler_status(app: AppHandle, host_id: String) -> Result<Vec<TaskStatus>, String> {
    // spawn_blocking: shells out to crontab/schtasks once per task.
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let host_id = sanitize_id(&host_id)?;

        let mut statuses = Vec::new();
        for spec in jobfile::list(&dirs, &host_id) {
            // Per-task backend: a macOS user-mode task's state lives in launchd, a system-mode
            // task's in crontab.
            let backend = backend_for(&dirs, spec.is_user_mode());
            let install_state = backend
                .as_ref()
                .ok()
                .map(|backend| backend.is_installed(&spec.task_id))
                .and_then(Result::ok)
                .unwrap_or(InstallState::NotInstalled);
            let (installed, enabled) = match install_state {
                InstallState::NotInstalled => (false, false),
                InstallState::Installed { enabled } => (true, enabled),
            };
            let warning = backend
                .as_ref()
                .ok()
                .and_then(|backend| backend.health_warning(&spec.task_id));

            let running = history::is_running(&dirs, &spec.task_id);
            let lines = history::read(&dirs, &spec.task_id, 20);
            let event_of = |line: &serde_json::Value| {
                line.get("event").and_then(|e| e.as_str()).map(str::to_owned)
            };
            // Newest-first: the latest started/finished event is the latest ATTEMPT. A started
            // with no finished and no live lock is a run that died without writing its terminal
            // record (crash, SIGKILL, power loss, Task Scheduler hard timeout) — surfacing the
            // older success (or "Never") instead would hide the interruption.
            let newest_attempt = lines.iter().find(|line| {
                matches!(event_of(line).as_deref(), Some("started") | Some("finished"))
            });
            let last_finished = match newest_attempt {
                Some(line) if event_of(line).as_deref() == Some("started") && !running => {
                    Some(serde_json::json!({
                        "runId": line.get("runId").cloned().unwrap_or_default(),
                        "ts": line.get("ts").cloned().unwrap_or_default(),
                        "success": false,
                        "error": "The run was interrupted before it could finish (crash, forced shutdown, or power loss).",
                        "durationMs": 0,
                        "interrupted": true,
                    }))
                }
                _ => lines
                    .iter()
                    .find(|line| event_of(line).as_deref() == Some("finished"))
                    .cloned(),
            };
            statuses.push(TaskStatus {
                task_id: spec.task_id.clone(),
                installed,
                enabled,
                running,
                last_finished,
                warning,
            });
        }
        Ok(statuses)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogContent {
    pub content: String,
    pub truncated: bool,
}

/// Tail of a task's log for the in-app viewer. `which`: "runner" (our runner's lines) or
/// "daemon" (the transient rclone daemon's stderr).
#[tauri::command]
pub fn scheduler_read_log(
    app: AppHandle,
    task_id: String,
    which: String,
) -> Result<LogContent, String> {
    const MAX_TAIL_BYTES: usize = 64 * 1024;

    let dirs = storeread::app_dirs_from(&app)?;
    let task_id = sanitize_id(&task_id)?;
    let path = match which.as_str() {
        "runner" => history::log_path(&dirs, &task_id),
        "daemon" => history::log_path(&dirs, &task_id).with_extension("daemon.log"),
        other => return Err(format!("unknown log '{}'", other)),
    };

    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(LogContent {
            content: String::new(),
            truncated: false,
        });
    };

    let truncated = bytes.len() > MAX_TAIL_BYTES;
    let tail = if truncated {
        let cut = bytes.len() - MAX_TAIL_BYTES;
        // Align to the next line boundary so the viewer never starts mid-line.
        let aligned = bytes[cut..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|i| cut + i + 1)
            .unwrap_or(cut);
        &bytes[aligned..]
    } else {
        &bytes[..]
    };

    Ok(LogContent {
        content: String::from_utf8_lossy(tail).into_owned(),
        truncated,
    })
}

#[tauri::command]
pub async fn scheduler_read_history(
    app: AppHandle,
    task_id: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let task_id = sanitize_id(&task_id)?;
        Ok(history::read(&dirs, &task_id, limit.unwrap_or(50)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub fix: Option<String>,
}

/// Preflight diagnostics with actionable fixes — the "why didn't my task run" surface.
#[tauri::command]
pub async fn scheduler_doctor() -> Result<Vec<DoctorCheck>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut checks: Vec<DoctorCheck> = Vec::new();

        if crate::is_flatpak() {
            // Scheduling works under Flatpak through the host's cron (crontab via
            // `flatpak-spawn --host`, entries re-launch the app with `flatpak run`). The startup
            // gate normally guarantees these permissions; verify anyway so the doctor stays
            // truthful if that gate ever changes.
            let ok = crate::has_flatpak_permissions();
            checks.push(DoctorCheck {
                name: "Sandbox host access".to_string(),
                ok,
                detail: if ok {
                    "host filesystem and host-spawn access are granted — scheduling uses the host's cron"
                        .to_string()
                } else {
                    "missing host filesystem or host-spawn permission — the app cannot reach the host's crontab"
                        .to_string()
                },
                fix: if ok {
                    None
                } else {
                    Some(format!(
                        "Grant it: flatpak override --user --filesystem=host --talk-name=org.freedesktop.Flatpak {}",
                        flatpak_app_id()
                    ))
                },
            });
            if !ok {
                return Ok(checks);
            }
        }

        #[cfg(unix)]
        {
            match crontab::check_available() {
                Ok(()) => checks.push(DoctorCheck {
                    name: "cron installed".to_string(),
                    ok: true,
                    detail: if crate::is_flatpak() {
                        "crontab found on the host".to_string()
                    } else {
                        "crontab found in PATH".to_string()
                    },
                    fix: None,
                }),
                Err(_) => {
                    checks.push(DoctorCheck {
                        name: "cron installed".to_string(),
                        ok: false,
                        detail: if crate::is_flatpak() {
                            "no crontab binary found on the host".to_string()
                        } else {
                            "no crontab binary found in PATH".to_string()
                        },
                        fix: Some(
                            "Install 'cron' (Debian/Ubuntu) or 'cronie' (Fedora/Arch), then restart the app."
                                .to_string(),
                        ),
                    });
                    return Ok(checks);
                }
            }

            match crontab::host_command("crontab").arg("-l").output() {
                Ok(output) if output.status.success() => {
                    let managed = String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .filter(|line| line.trim_start().starts_with("# rclone-ui-task:"))
                        .count();
                    checks.push(DoctorCheck {
                        name: "crontab access".to_string(),
                        ok: true,
                        detail: format!("{} scheduled task(s) registered", managed),
                        fix: None,
                    });
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if crontab::stderr_means_no_crontab(&stderr) {
                        checks.push(DoctorCheck {
                            name: "crontab access".to_string(),
                            ok: true,
                            detail: "no crontab yet — created on first schedule".to_string(),
                            fix: None,
                        });
                    } else {
                        checks.push(DoctorCheck {
                            name: "crontab access".to_string(),
                            ok: false,
                            detail: format!("crontab -l failed: {}", stderr.trim()),
                            fix: Some(
                                "Your user may be denied cron access (cron.deny / system policy)."
                                    .to_string(),
                            ),
                        });
                    }
                }
                Err(e) => checks.push(DoctorCheck {
                    name: "crontab access".to_string(),
                    ok: false,
                    detail: format!("could not run crontab: {}", e),
                    fix: None,
                }),
            }
        }

        #[cfg(target_os = "linux")]
        {
            // Inside the Flatpak sandbox (own PID namespace) host processes are invisible to
            // sysinfo — list them on the host instead.
            let cron_running = if crate::is_flatpak() {
                crontab::host_command("sh")
                    .arg("-c")
                    .arg("ps -e -o comm=")
                    .output()
                    .map(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .lines()
                            .any(|name| matches!(name.trim(), "cron" | "crond" | "cronie"))
                    })
                    .unwrap_or(false)
            } else {
                let mut system = sysinfo::System::new();
                system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                system.processes().values().any(|process| {
                    let name = process.name().to_string_lossy().to_lowercase();
                    name == "cron" || name == "crond" || name == "cronie"
                })
            };
            checks.push(DoctorCheck {
                name: "cron service".to_string(),
                ok: cron_running,
                detail: if cron_running {
                    "cron daemon is running".to_string()
                } else {
                    "no cron daemon process found — schedules will not fire".to_string()
                },
                fix: if cron_running {
                    None
                } else {
                    Some("Enable it: sudo systemctl enable --now cron (or cronie)".to_string())
                },
            });
        }

        #[cfg(target_os = "macos")]
        {
            // TCC is the common silent failure for tasks touching Desktop/Documents/Downloads or
            // external/network volumes. The fix differs by run mode: user-mode tasks run as the
            // app via a LaunchAgent (grant the app), system-mode tasks run under cron (grant cron).
            checks.push(DoctorCheck {
                name: "macOS privacy (TCC)".to_string(),
                ok: true,
                detail:
                    "Tasks reading protected folders (Desktop, Documents, Downloads) or external/network volumes may be blocked by macOS privacy protections. A scheduled run cannot show a permission prompt, so access must be granted beforehand."
                        .to_string(),
                fix: Some(
                    "'User' run mode (default): grant Rclone UI access to the folder, or add Rclone UI to Full Disk Access in System Settings → Privacy & Security. 'System' run mode: grant Full Disk Access to /usr/sbin/cron instead."
                        .to_string(),
                ),
            });
        }

        #[cfg(target_os = "windows")]
        {
            let query = std::process::Command::new("schtasks").arg("/Query").output();
            let ok = query.map(|o| o.status.success()).unwrap_or(false);
            checks.push(DoctorCheck {
                name: "Task Scheduler".to_string(),
                ok,
                detail: if ok {
                    "Task Scheduler service is reachable".to_string()
                } else {
                    "schtasks query failed — the Task Scheduler service may be disabled".to_string()
                },
                fix: if ok {
                    None
                } else {
                    Some("Start the 'Task Scheduler' service (services.msc).".to_string())
                },
            });
            checks.push(DoctorCheck {
                name: "Runs while logged out".to_string(),
                ok: true,
                detail:
                    "Schedules in 'System' run mode run while logged out (S4U) but cannot access mapped drives or implicit-auth network shares — schedules that need them should use the 'User' run mode. S4U also requires the 'Log on as a batch job' right: on domain-managed machines that deny it, System-mode tasks register but never start."
                        .to_string(),
                fix: None,
            });
        }

        Ok(checks)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove every registration this app ever made (Settings escape hatch / pre-uninstall cleanup).
/// Sweeps both job files and orphaned OS artifacts by prefix.
#[tauri::command]
pub async fn scheduler_unregister_all(app: AppHandle) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let _guard = mutation_guard();
        let backends = all_backends(&dirs);
        let mut removed: u32 = 0;

        let jobs_root = dirs.app_data.join("scheduler").join("jobs");
        if let Ok(host_dirs) = std::fs::read_dir(&jobs_root) {
            for host_dir in host_dirs.flatten() {
                let host_id = host_dir.file_name().to_string_lossy().to_string();
                for spec in jobfile::list(&dirs, &host_id) {
                    // Uninstall from every backend (macOS: launchd + crontab).
                    if backends.iter().any(|b| b.uninstall(&spec.task_id).is_ok()) {
                        removed += 1;
                    }
                    jobfile::remove(&dirs, &host_id, &spec.task_id);
                    history::remove_all(&dirs, &spec.task_id);
                }
            }
        }

        // Orphan sweep: artifacts whose job files were lost, across every backend.
        removed += sweep_orphans(&dirs);
        Ok(removed)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Task ids that still have a job file — by FILENAME, deliberately not by parse: an unreadable
/// or newer-schema job file is an environment problem, and sweeping its artifact would destroy
/// a valid registration (same conservatism as the runner's self-heal).
fn registered_task_ids(dirs: &AppDirs) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    let jobs_root = dirs.app_data.join("scheduler").join("jobs");
    let Ok(host_dirs) = std::fs::read_dir(&jobs_root) else {
        return ids;
    };
    for host_dir in host_dirs.flatten() {
        let Ok(entries) = std::fs::read_dir(host_dir.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) = name.strip_suffix(".json") {
                ids.insert(id.to_string());
            }
        }
    }
    ids
}

/// Sweep OS artifacts that have NO job file, across every backend on this platform (macOS:
/// crontab + launchd). These leftovers appear when an OS-level uninstall fails after the job
/// file was removed; a DISABLED leftover never fires, so the runner's fire-time self-heal can
/// never reach it — this sweep is the only thing that does.
fn sweep_orphans(dirs: &AppDirs) -> u32 {
    let keep = registered_task_ids(dirs);
    #[cfg(target_os = "macos")]
    {
        let mut removed = 0;
        if let Ok(cron) = backend_for(dirs, false) {
            removed += crontab::sweep_orphans(&*cron, &keep);
        }
        let launchd_backend = launchd::LaunchdBackend::new(dirs);
        removed += launchd::sweep_orphans(dirs, &launchd_backend, &keep);
        removed
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match backend(dirs) {
            Ok(b) => crontab::sweep_orphans(&*b, &keep),
            Err(_) => 0,
        }
    }
    #[cfg(target_os = "windows")]
    {
        match backend(dirs) {
            Ok(b) => schtasks::sweep_orphans(&*b, &keep, dirs),
            Err(_) => 0,
        }
    }
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = (dirs, keep);
        0
    }
}

/// Startup-reconcile hook for the sweep above. Runs AFTER the reconcile has re-registered every
/// stored task (their job files then exist and protect their artifacts).
#[tauri::command]
pub async fn scheduler_sweep_orphans(app: AppHandle) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let _guard = mutation_guard();
        Ok(sweep_orphans(&dirs))
    })
    .await
    .map_err(|e| e.to_string())?
}
