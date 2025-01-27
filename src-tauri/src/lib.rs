// use tauri::Manager;

// #[derive(Clone, serde::Serialize)]
// struct Payload {
//     args: Vec<String>,
//     cwd: String,
// }



use std::fs::{self, File};
use std::path::Path;
use zip::ZipArchive;

#[tauri::command]
fn unzip_file(zip_path: &str, output_folder: &str) -> Result<(), String> {
	// Open the zip file
	let file = File::open(zip_path).map_err(|e| e.to_string())?;
	
	// Create output directory if it doesn't exist
	fs::create_dir_all(output_folder).map_err(|e| e.to_string())?;
	
	// Create ZIP archive reader
	let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
	
	// Extract everything
	for i in 0..archive.len() {
		let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
		let outpath = Path::new(output_folder).join(file.name());
		
		if file.name().ends_with('/') {
			fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
		} else {
			if let Some(p) = outpath.parent() {
				fs::create_dir_all(p).map_err(|e| e.to_string())?;
			}
			let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
			std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
		}
		
		// Get and set permissions (Unix only)
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			if let Some(mode) = file.unix_mode() {
				fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))
					.map_err(|e| e.to_string())?;
			}
		}
	}
	
	Ok(())
}

#[tauri::command]
fn get_arch() -> String {
    let arch = std::env::consts::ARCH;
    
    match arch {
        "aarch64" => "arm64".to_string(),
        "x86_64" => "amd64".to_string(),
		"i386" => "386".to_string(),
        _ => "unknown".to_string(),
    }
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut app = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        // .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // 	println!("{}, {argv:?}, {cwd}", app.package_info().name);
        // 	// app.emit("single-instance", Payload { args: argv, cwd }).unwrap();
        // }))
        // .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        //     let _ = app
        //         .get_webview_window("main")
        //         .expect("no main window")
        //         .set_focus();
        // }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
		.invoke_handler(tauri::generate_handler![unzip_file, get_arch])
        .setup(|_app| Ok(()))
        // .setup(|app| {
        //     if cfg!(debug_assertions) {
        //         app.handle().plugin(
        //             tauri_plugin_log::Builder::default()
        //                 .level(log::LevelFilter::Info)
        //                 .build(),
        //         )?;
        //     }
        //     Ok(())
        // })
        // .setup(|app| {
        //     let win_builder =
        // 		tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        // 		.title("Transparent Titlebar Window")
        // 		.inner_size(800.0, 600.0);
        // 	// set transparent title bar only when building for macOS
        // 	#[cfg(target_os = "macos")]
        // 	let win_builder = win_builder.title_bar_style(tauri::TitleBarStyle::Transparent);
        // 	let window = win_builder.build().unwrap();
        // 	// set background color only when building for macOS
        // 	#[cfg(target_os = "macos")]
        // 	{
        // 		use cocoa::appkit::{NSColor, NSWindow};
        // 		use cocoa::base::{id, nil};
        // 		let ns_window = window.ns_window().unwrap() as id;
        // 		unsafe {
        // 		let bg_color = NSColor::colorWithRed_green_blue_alpha_(
        // 			nil,
        // 			138.0 / 255.0,
        // 			43.0 / 255.0,
        // 			226.0 / 255.0,
        // 			1.0,
        // 		);
        // 		ns_window.setBackgroundColor_(bg_color);
        // 		}
        // 	}
        // 	Ok(())
        // })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    // prevents only app close
    // app.run(|app_handle, e| {
    // 	if let tauri::RunEvent::ExitRequested { api, .. } = &e {
    // 		// Keep the event loop running even if all windows are closed
    // 		// This allow us to catch system tray events when there is no window
    // 		api.prevent_exit();
    // 	  }
    // });

    // also prevents window close
    // RS: https://github.com/tauri-apps/tauri/issues/5500#issuecomment-1300258861
    // JS: https://github.com/tauri-apps/tauri/blob/4cbdf0fb1c0de5004eab51c36d5843a9816f18af/examples/api/src/App.svelte#L26
    // app.run(|app, event| match event {
    //     tauri::RunEvent::WindowEvent {
    //         label,
    //         event: win_event,
    //         ..
    //     } => match win_event {
    //         tauri::WindowEvent::CloseRequested { api, .. } => {
    //             let win = app.get_webview_window(label.as_str()).unwrap();
    //             win.hide().unwrap();
    //             api.prevent_close();
    //         }
    //         _ => {}
    //     },
    //     _ => {}
    // })
    app.run(|_app, _event| {})
}
