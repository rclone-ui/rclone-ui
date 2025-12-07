use tauri::{AppHandle, Manager, PhysicalSize, Size, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use super::window::make_transparent;

pub const DEFAULT_TOOLBAR_SHORTCUT: &str = "CmdOrCtrl+Shift+/";
const TOOLBAR_WINDOW_LABEL: &str = "Toolbar";

// Fixed physical size for the toolbar window on Windows (in physical pixels)
// This avoids DPI scaling issues on multi-monitor setups with different scale factors
#[cfg(target_os = "windows")]
const TOOLBAR_PHYSICAL_WIDTH: u32 = 702;
#[cfg(target_os = "windows")]
const TOOLBAR_PHYSICAL_HEIGHT: u32 = 460;

fn create_toolbar_window(app_handle: &AppHandle) -> Result<WebviewWindow, tauri::Error> {
    let monitor = match app_handle.primary_monitor()? {
        Some(monitor) => monitor,
        None => app_handle
            .available_monitors()?
            .into_iter()
            .next()
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "No monitors available")
            })?,
    };

    let physical_size = monitor.size();
    let physical_position = monitor.position();

    // On Windows, use physical pixels directly to avoid DPI scaling issues
    // across multiple monitors with different scale factors
    #[cfg(target_os = "windows")]
    let builder = {
        // Calculate position in physical pixels, centered on the primary monitor
        let pos_x = physical_position.x + ((physical_size.width - TOOLBAR_PHYSICAL_WIDTH) / 2) as i32;
        let pos_y = physical_position.y + (physical_size.height / 4) as i32;

        WebviewWindowBuilder::new(
            app_handle,
            TOOLBAR_WINDOW_LABEL,
            tauri::WebviewUrl::App("/toolbar".into()),
        )
        .title(TOOLBAR_WINDOW_LABEL)
        // Use initial size (will be corrected to physical pixels after creation)
        .inner_size(TOOLBAR_PHYSICAL_WIDTH as f64, TOOLBAR_PHYSICAL_HEIGHT as f64)
        .position(pos_x as f64, pos_y as f64)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .zoom_hotkeys_enabled(false)
    };

    // On macOS and Linux, use logical coordinates (full screen size for click-through)
    #[cfg(not(target_os = "windows"))]
    let builder = {
        let scale_factor = monitor.scale_factor();
        let logical_size = physical_size.to_logical::<f64>(scale_factor);
        let logical_position = physical_position.to_logical::<f64>(scale_factor);

        let pos_x = logical_position.x;
        let pos_y = logical_position.y + (logical_size.height / 4.0);

        let mut b = WebviewWindowBuilder::new(
            app_handle,
            TOOLBAR_WINDOW_LABEL,
            tauri::WebviewUrl::App("/toolbar".into()),
        )
        .title(TOOLBAR_WINDOW_LABEL)
        .inner_size(logical_size.width, logical_size.height)
        .position(pos_x, pos_y)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .zoom_hotkeys_enabled(false);

        #[cfg(target_os = "linux")]
        {
            b = b.transparent(true);
        }

        b
    };

    let window = builder.build()?;

    // On Windows, explicitly set the size in physical pixels to ensure
    // consistent sizing regardless of which monitor's DPI context is used
    #[cfg(target_os = "windows")]
    {
        let physical_size = PhysicalSize::new(TOOLBAR_PHYSICAL_WIDTH, TOOLBAR_PHYSICAL_HEIGHT);
        window.set_size(Size::Physical(physical_size))?;
    }

    window.set_zoom(1.0)?;
    window.hide()?;

    #[cfg(target_os = "macos")]
    if let Err(err) = make_transparent(&window) {
        log::warn!("failed to make toolbar window transparent: {}", err);
    }

    Ok(window)
}

pub fn ensure_toolbar_window(app_handle: &AppHandle) -> Result<(), tauri::Error> {
    if app_handle
        .get_webview_window(TOOLBAR_WINDOW_LABEL)
        .is_none()
    {
        create_toolbar_window(app_handle)?;
    }
    Ok(())
}

pub fn show_toolbar_window(app_handle: &AppHandle) -> Result<(), tauri::Error> {
    ensure_toolbar_window(app_handle)?;

    if let Some(window) = app_handle.get_webview_window(TOOLBAR_WINDOW_LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }

    Ok(())
}

fn open_toolbar(app_handle: &AppHandle) -> Result<(), tauri::Error> {
    ensure_toolbar_window(app_handle)?;

    if let Some(window) = app_handle.get_webview_window(TOOLBAR_WINDOW_LABEL) {
        if window.is_visible()? {
            window.hide()?;
        } else {
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }
    }

    Ok(())
}

fn parse_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    shortcut.parse::<Shortcut>().map_err(|e| e.to_string())
}

fn register_toolbar_shortcut(app_handle: &AppHandle, shortcut: &str) -> Result<(), String> {
    let parsed = parse_shortcut(shortcut)?;
    app_handle
        .global_shortcut()
        .on_shortcut(parsed, |app, _shortcut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                if let Err(err) = open_toolbar(app) {
                    log::error!("failed to open toolbar via shortcut: {}", err);
                }
            }
        })
        .map_err(|e| e.to_string())
}

pub fn set_toolbar_shortcut(app_handle: &AppHandle, shortcut: Option<&str>) -> Result<(), String> {
    let shortcut = shortcut
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    app_handle
        .global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    if let Some(shortcut) = shortcut {
        register_toolbar_shortcut(app_handle, shortcut.as_str())?;
    }

    Ok(())
}
