//! The notification engine: event catalog, webhook targets + dispatch, and the headless
//! runner's OS toast. The GUI drives it through the commands below (lib/notifications.ts);
//! the scheduler runner calls webhooks::dispatch / os::notify_headless directly. GUI OS toasts
//! are NOT here — JS uses @tauri-apps/plugin-notification for those.

pub mod catalog;
pub mod os;
pub mod targets;
pub mod webhooks;

use serde::Serialize;
use tauri::AppHandle;

use crate::scheduler::storeread;

#[derive(Serialize)]
pub struct Catalog {
    pub categories: &'static [catalog::CategoryMeta],
    pub events: &'static [catalog::EventMeta],
}

#[tauri::command]
pub fn notifications_catalog() -> Catalog {
    Catalog {
        categories: &catalog::CATEGORIES,
        events: &catalog::EVENTS,
    }
}

#[tauri::command]
pub async fn notifications_list_targets(
    app: AppHandle,
) -> Result<Vec<targets::NotificationTarget>, String> {
    // spawn_blocking: the cross-process store lock can wait up to ~10s under contention.
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        targets::load(&dirs)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

#[tauri::command]
pub async fn notifications_add_target(
    app: AppHandle,
    target: targets::NewTarget,
) -> Result<targets::NotificationTarget, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        targets::add(&dirs, target)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

#[tauri::command]
pub async fn notifications_update_target(
    app: AppHandle,
    id: String,
    patch: targets::TargetPatch,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        targets::update(&dirs, &id, patch)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

#[tauri::command]
pub async fn notifications_remove_target(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        targets::remove(&dirs, &id)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

/// Fire-and-forget for the caller: delivery failures are recorded per target and logged, never
/// returned as an error (matching the old TS dispatchNotification contract).
#[tauri::command]
pub async fn notifications_dispatch(
    app: AppHandle,
    event_id: String,
    title: String,
    body: String,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        let client = webhooks::http_client();
        for line in webhooks::dispatch(
            &dirs,
            &client,
            &event_id,
            &title,
            &body,
            data.unwrap_or(serde_json::Value::Null),
        ) {
            log::warn!("[notifications] {}", line);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

/// Errors propagate — the UI shows them in the "Test failed" dialog.
#[tauri::command]
pub async fn notifications_send_test(
    app: AppHandle,
    provider: String,
    url: String,
    target_id: Option<String>,
    name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = storeread::app_dirs_from(&app)?;
        webhooks::send_test(&dirs, &provider, &url, target_id.as_deref(), name.as_deref())
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}
