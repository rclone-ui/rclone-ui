#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	#[cfg(target_os = "linux")]
	{
		let is_dri_present = std::path::Path::new("/dev/dri").exists();
		let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
		let is_x11_session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default() == "x11";
		if is_dri_present && !is_wayland && is_x11_session {
			if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
				std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
			}
		}
	}
	let _ = fix_path_env::fix();
    app_lib::run();
}
