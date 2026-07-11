//! Read-only access to the app's persisted stores for the headless runner and the scheduler
//! commands.
//!
//! Store files are written by tauri-plugin-store + zustand persist: each file is a JSON object
//! whose single key holds a JSON *string* containing `{"state": {...}, "version": n}` — so the
//! value must be parsed twice. Only the fields the scheduler needs are modeled; unknown fields
//! are ignored so unrelated store changes never break the runner.
//!
//! Do NOT add Flatpak `~/.var/app/...` path probing here: inside the sandbox `dirs::data_dir()`
//! already resolves (via XDG_DATA_HOME) to the same remapped path the GUI writes, so the runner
//! reads the identical store — extra path rewriting would only risk pointing at the wrong file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Deserialize;

/// Must match tauri.conf.json `identifier`.
const APP_IDENTIFIER: &str = "com.rclone.ui";

pub struct AppDirs {
    /// Store files (tauri-plugin-store resolves against BaseDirectory::AppData — Roaming on
    /// Windows).
    pub app_data: PathBuf,
    /// rclone binaries + `configs/` (the JS side uses appLocalDataDir — Local on Windows).
    pub app_local_data: PathBuf,
}

/// Headless resolution — mirrors tauri v2's resolver, which computes app_data_dir as
/// `dirs::data_dir()/<identifier>` and app_local_data_dir as `dirs::data_local_dir()/<identifier>`.
pub fn app_dirs() -> Result<AppDirs, String> {
    let data = dirs::data_dir().ok_or("could not resolve the user data directory")?;
    let local = dirs::data_local_dir().ok_or("could not resolve the local data directory")?;
    Ok(AppDirs {
        app_data: data.join(APP_IDENTIFIER),
        app_local_data: local.join(APP_IDENTIFIER),
    })
}

/// GUI-side resolution via the AppHandle so paths are byte-identical with the webview's.
pub fn app_dirs_from(app: &tauri::AppHandle) -> Result<AppDirs, String> {
    use tauri::Manager;
    Ok(AppDirs {
        app_data: app
            .path()
            .app_data_dir()
            .map_err(|e| format!("failed to resolve app data dir: {}", e))?,
        app_local_data: app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("failed to resolve app local data dir: {}", e))?,
    })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RootState {
    pub rclone_path: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostState {
    pub proxy: Option<ProxyCfg>,
    pub config_files: Vec<ConfigFileEntry>,
    pub default_config_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyCfg {
    pub url: String,
    pub ignored_hosts: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigFileEntry {
    pub id: Option<String>,
    pub label: Option<String>,
    pub is_encrypted: bool,
    pub pass: Option<String>,
    pub pass_command: Option<String>,
}

#[derive(Deserialize)]
struct PersistWrapper<T> {
    state: T,
}

fn read_double_encoded<T: DeserializeOwned>(path: &Path, key: &str) -> Result<T, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
    let outer: HashMap<String, serde_json::Value> = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid store file {}: {}", path.display(), e))?;
    let inner = outer
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("store key '{}' missing in {}", key, path.display()))?;
    let wrapper: PersistWrapper<T> = serde_json::from_str(inner)
        .map_err(|e| format!("invalid '{}' state in {}: {}", key, path.display(), e))?;
    Ok(wrapper.state)
}

pub fn read_root(dirs: &AppDirs) -> Result<RootState, String> {
    read_double_encoded(&dirs.app_data.join("store.json"), "store")
}

pub fn read_host(dirs: &AppDirs, host_id: &str) -> Result<HostState, String> {
    read_double_encoded(
        &dirs.app_data.join("hosts").join(host_id).join("store.json"),
        "host-store",
    )
}

/// Mirrors lib/rclone/common.ts getConfigPath: `configs/<id>/rclone.conf` under AppLocalData,
/// except config id 'default' uses the host store's defaultConfigPath when set (so switching
/// binaries never relocates the user's remotes).
pub fn resolve_config_path(dirs: &AppDirs, host: &HostState, config_id: &str) -> PathBuf {
    if config_id == "default" {
        if let Some(p) = host.default_config_path.as_deref() {
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
    }
    dirs.app_local_data
        .join("configs")
        .join(config_id)
        .join("rclone.conf")
}

pub fn find_config<'a>(host: &'a HostState, config_id: &str) -> Option<&'a ConfigFileEntry> {
    host.config_files
        .iter()
        .find(|c| c.id.as_deref() == Some(config_id))
}

/// Mirrors lib/rclone/cli.ts buildRcloneEnv: proxy vars, config pinning, and encrypted-config
/// credentials. Errors when the config is encrypted with nothing stored — the headless runner
/// has no UI to prompt with.
pub fn build_run_env(
    host: &HostState,
    config: Option<&ConfigFileEntry>,
    config_path: &Path,
) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();

    if let Some(proxy) = &host.proxy {
        if !proxy.url.is_empty() {
            for key in ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"] {
                env.insert(key.to_string(), proxy.url.clone());
            }
            if !proxy.ignored_hosts.is_empty() {
                let joined = proxy.ignored_hosts.join(",");
                env.insert("no_proxy".to_string(), joined.clone());
                env.insert("NO_PROXY".to_string(), joined);
            }
        }
    }

    let config_dir = config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    env.insert(
        "RCLONE_CONFIG_DIR".to_string(),
        config_dir.to_string_lossy().into_owned(),
    );
    env.insert(
        "RCLONE_CONFIG".to_string(),
        config_path.to_string_lossy().into_owned(),
    );

    if let Some(cfg) = config {
        if cfg.is_encrypted {
            env.insert("RCLONE_ASK_PASSWORD".to_string(), "false".to_string());
            if let Some(cmd) = cfg.pass_command.as_deref().filter(|s| !s.is_empty()) {
                env.insert("RCLONE_CONFIG_PASS_COMMAND".to_string(), cmd.to_string());
            } else if let Some(pass) = cfg.pass.as_deref().filter(|s| !s.is_empty()) {
                env.insert("RCLONE_CONFIG_PASS".to_string(), pass.to_string());
            } else {
                let label = cfg.label.clone().unwrap_or_else(|| "default".to_string());
                return Err(format!(
                    "Config '{}' is encrypted and no password is stored. Open Rclone UI and save the config password to enable scheduled runs.",
                    label
                ));
            }
        }
    }

    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn double_decode_reads_state() {
        let dir = std::env::temp_dir().join(format!("rcloneui-storetest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.json");
        let inner = r#"{"state":{"rclonePath":"/usr/local/bin/rclone","notificationTargets":[{"provider":"slack","url":"https://hooks.slack.com/services/T1/B1/x","isEnabled":true,"events":["schedule.failed"]}],"unknownField":123},"version":3}"#;
        let outer = serde_json::json!({ "store": inner });
        std::fs::write(&path, serde_json::to_string(&outer).unwrap()).unwrap();

        // notificationTargets moved to notifications/targets.json — here it's just one more
        // unknown field that must not break the decode.
        let state: RootState = read_double_encoded(&path, "store").unwrap();
        assert_eq!(state.rclone_path.as_deref(), Some("/usr/local/bin/rclone"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn encrypted_config_without_pass_errors() {
        let host = HostState::default();
        let cfg = ConfigFileEntry {
            id: Some("default".into()),
            label: Some("Default config".into()),
            is_encrypted: true,
            ..Default::default()
        };
        let err = build_run_env(&host, Some(&cfg), Path::new("/tmp/rclone.conf")).unwrap_err();
        assert!(err.contains("encrypted"));
    }
}
