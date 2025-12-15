use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
pub fn make_transparent(window: &WebviewWindow) -> Result<(), tauri::Error> {
    use cocoa::{
        appkit::NSColor,
        base::{id, nil},
        foundation::NSString,
    };
    use objc::{class, msg_send, runtime::Object, sel, sel_impl};

    window.with_webview(|webview| unsafe {
        let webview_obj = webview.inner() as *mut Object;
        let no_value: id = msg_send![class!(NSNumber), numberWithBool:0];
        let key = NSString::alloc(nil).init_str("drawsBackground");
        let _: id = msg_send![webview_obj, setValue:no_value forKey:key];
        let _: () = msg_send![key, release];
        let ns_window: id = msg_send![webview_obj, window];
        let bg_color = NSColor::colorWithSRGBRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 0.0);
        let _: id = msg_send![ns_window, setBackgroundColor: bg_color];
        // let _: () = msg_send![ns_window, setIgnoresMouseEvents:true];
    })?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn make_transparent(_window: &WebviewWindow) -> Result<(), tauri::Error> {
    Ok(())
}

#[tauri::command]
pub async fn open_full_window(
    app_handle: AppHandle,
    name: String,
    url: String,
) -> Result<(), String> {
    if let Some(existing) = app_handle.get_webview_window(&name) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
	
    let os = std::env::consts::OS;

    let primary_monitor = app_handle
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app_handle.available_monitors().ok()?.into_iter().next());

    let monitor = primary_monitor.ok_or("No monitor found")?;
    let physical_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let logical_size = physical_size.to_logical::<f64>(scale_factor);

    let width = logical_size.width;
    let mut height = logical_size.height;

    if os == "windows" {
        height -= 100.0;
    }

    let window = WebviewWindowBuilder::new(&app_handle, &name, WebviewUrl::App(url.into()))
        .title(&name)
        .inner_size(width, height)
        .resizable(true)
        .visible(false)
        .focused(false)
        .decorations(true)
        // .additional_browser_args("--disable-pinch")
        .zoom_hotkeys_enabled(false)
        .build()
        .map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(750));

    window.center().map_err(|e| e.to_string())?;
    window.set_zoom(1.0).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    if os != "windows" && os != "macos" {
        window.set_resizable(false).map_err(|e| e.to_string())?;
        window.set_resizable(true).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_window(
    app_handle: AppHandle,
    name: String,
    url: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    if let Some(existing) = app_handle.get_webview_window(&name) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
	
	let os = std::env::consts::OS;

    let default_height = if os == "windows" { 755.0 } else { 725.0 };
    let width = width.unwrap_or(840.0);
    let height = height.unwrap_or(default_height);

    let mut builder = WebviewWindowBuilder::new(&app_handle, &name, WebviewUrl::App(url.into()))
        .title(&name)
        .inner_size(width, height)
        .resizable(false)
        .visible(false)
        .focused(false)
        .decorations(true)
        .zoom_hotkeys_enabled(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
	
	std::thread::sleep(std::time::Duration::from_millis(750));

    // window.center().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app_handle.primary_monitor().ok().flatten())
        .ok_or("Monitor not found")?;

    let screen_size = monitor.size();
    let monitor_pos = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = monitor_pos.x + (screen_size.width as i32 - window_size.width as i32) / 2;
    let y = monitor_pos.y + (screen_size.height as i32 - window_size.height as i32) / 2;

    let count = app_handle.webview_windows().len() as i32;
    let offset = count * 20;
    let sign = if count % 2 != 0 { -1 } else { 1 };
    let final_offset = offset * sign;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: x + final_offset,
            y: y + final_offset,
        }))
        .map_err(|e| e.to_string())?;
		
    window.set_zoom(1.0).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    if os != "windows" && os != "macos" {
		window.set_resizable(true).map_err(|e| e.to_string())?;
        window.set_resizable(false).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_small_window(
    app_handle: AppHandle,
    name: String,
    url: String,
) -> Result<(), String> {
	if let Some(existing) = app_handle.get_webview_window(&name) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
	
    let os = std::env::consts::OS;

    let mut builder = WebviewWindowBuilder::new(&app_handle, &name, WebviewUrl::App(url.into()))
        .title(&name)
        .inner_size(800.0, 500.0)
        .resizable(false)
        .visible(false)
        .focused(false)
        .decorations(false)
        .closable(false)
		.shadow(false)
		.zoom_hotkeys_enabled(false);

	#[cfg(target_os = "linux")]
    {
        builder = builder.transparent(true);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    window.center().map_err(|e| e.to_string())?;
    window.set_zoom(1.0).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    if let Err(err) = make_transparent(&window) {
        log::warn!("failed to make small window transparent: {}", err);
    }
	
	std::thread::sleep(std::time::Duration::from_millis(750));

	window.set_decorations(false).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    if os != "windows" && os != "macos" {
        window.set_resizable(true).map_err(|e| e.to_string())?;
        window.set_resizable(false).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn lock_windows(app_handle: AppHandle, ids: Option<Vec<String>>) -> Result<(), String> {
    let windows = app_handle.webview_windows();

    for (label, window) in windows.iter() {
        let should_lock = match &ids {
            Some(id_list) => id_list.contains(label),
            None => true,
        };

        if should_lock {
            window.set_closable(false).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn unlock_windows(app_handle: AppHandle, ids: Option<Vec<String>>) -> Result<(), String> {
    let windows = app_handle.webview_windows();

    for (label, window) in windows.iter() {
        let should_unlock = match &ids {
            Some(id_list) => id_list.contains(label),
            None => true,
        };

        if should_unlock {
            window.set_closable(true).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
