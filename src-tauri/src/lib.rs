// use tauri::Manager;

// #[derive(Clone, serde::Serialize)]
// struct Payload {
//     args: Vec<String>,
//     cwd: String,
// }

use machine_uid;
use std::fs::{self, File};
use std::path::Path;
use zip::ZipArchive;
use tauri_plugin_sentry::{minidump, sentry};

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

        if file.name().ends_with('/') || file.name().ends_with('\\') {
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
async fn stop_pid(pid: u32, timeout_ms: Option<u64>) -> Result<(), String> {
    let timeout = timeout_ms.unwrap_or(5000);

    #[cfg(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    {
        use std::time::{Duration, Instant};

        let pid_str = pid.to_string();

        // Try graceful termination first
        let _ = std::process::Command::new("kill")
            .args(&["-TERM", &pid_str])
            .status();

        let deadline = Instant::now() + Duration::from_millis(timeout);
        while Instant::now() < deadline {
            // Check if process still exists: kill -0 <pid>
            let alive = std::process::Command::new("kill")
                .args(&["-0", &pid_str])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !alive {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Force kill
        let _ = std::process::Command::new("kill")
            .args(&["-KILL", &pid_str])
            .status();

        // Final check (best effort)
        let alive = std::process::Command::new("kill")
            .args(&["-0", &pid_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if alive {
            return Err("Failed to terminate process".to_string());
        }

        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::time::{Duration, Instant};

        let pid_str = pid.to_string();

        // Try graceful termination first
        let _ = std::process::Command::new("taskkill")
            .args(&["/PID", &pid_str])
            .status();

        let deadline = Instant::now() + Duration::from_millis(timeout);
        while Instant::now() < deadline {
            let output = std::process::Command::new("tasklist")
                .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
                .output()
                .map_err(|e| e.to_string())?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            if stdout.trim().is_empty()
                || stdout.contains("No tasks are running")
                || !stdout.contains(&pid_str)
            {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Force kill
        let _ = std::process::Command::new("taskkill")
            .args(&["/PID", &pid_str, "/F", "/T"])
            .status();

        // Final check
        let output = std::process::Command::new("tasklist")
            .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if !stdout.trim().is_empty() && stdout.contains(&pid_str) && !stdout.contains("No tasks are running") {
            return Err("Failed to terminate process".to_string());
        }

        return Ok(());
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "windows"
    )))]
    {
        Err("Unsupported platform".to_string())
    }
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

#[tauri::command]
fn get_uid() -> String {
    return machine_uid::get().unwrap();
}

#[tauri::command]
async fn prompt_password(title: String, message: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        
        let script = format!(
            r#"display dialog "{}" with title "{}" default answer "" with hidden answer"#,
            message.replace("\"", "\\\""),
            title.replace("\"", "\\\"")
        );
        
        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;
            
        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout);
            // Parse AppleScript result: "text returned:password, button returned:OK"
            if let Some(password_part) = result.split("text returned:").nth(1) {
                if let Some(password) = password_part.split(", button returned:").next() {
                    return Ok(Some(password.to_string()));
                }
            }
        }
        
        Ok(None)
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        
        // Use PowerShell to create a credential dialog on Windows
        let powershell_script = format!(
            r#"
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            
            $form = New-Object System.Windows.Forms.Form
            $form.Text = '{}'
            $form.Size = New-Object System.Drawing.Size(350, 200)
            $form.StartPosition = 'CenterScreen'
            $form.FormBorderStyle = 'FixedDialog'
            $form.MaximizeBox = $false
            $form.MinimizeBox = $false
            $form.TopMost = $true
            
            $label = New-Object System.Windows.Forms.Label
            $label.Location = New-Object System.Drawing.Point(10, 20)
            $label.Size = New-Object System.Drawing.Size(320, 40)
            $label.Text = '{}'
            $form.Controls.Add($label)
            
            $textBox = New-Object System.Windows.Forms.TextBox
            $textBox.Location = New-Object System.Drawing.Point(10, 70)
            $textBox.Size = New-Object System.Drawing.Size(320, 20)
            $textBox.UseSystemPasswordChar = $true
            $form.Controls.Add($textBox)
            
            $okButton = New-Object System.Windows.Forms.Button
            $okButton.Location = New-Object System.Drawing.Point(175, 110)
            $okButton.Size = New-Object System.Drawing.Size(75, 23)
            $okButton.Text = 'OK'
            $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.AcceptButton = $okButton
            $form.Controls.Add($okButton)
            
            $cancelButton = New-Object System.Windows.Forms.Button
            $cancelButton.Location = New-Object System.Drawing.Point(255, 110)
            $cancelButton.Size = New-Object System.Drawing.Size(75, 23)
            $cancelButton.Text = 'Cancel'
            $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
            $form.CancelButton = $cancelButton
            $form.Controls.Add($cancelButton)
            
            $form.Add_Shown({{$textBox.Select()}})
            $result = $form.ShowDialog()
            
            if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{
                $textBox.Text
            }}
            "#,
            title.replace("'", "''"),
            message.replace("'", "''")
        );
        
        let output = Command::new("powershell")
            .args(&["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &powershell_script])
            .output()
            .map_err(|e| e.to_string())?;
            
        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !result.is_empty() {
                return Ok(Some(result));
            }
        }
        
        Ok(None)
    }
    
    #[cfg(target_os = "linux")]
    {
        // Try different methods for Linux
        
        // First try zenity (most common)
        if let Ok(output) = std::process::Command::new("zenity")
            .args(&["--password", "--title", &title, "--text", &message])
            .output()
        {
            if output.status.success() {
                let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !result.is_empty() {
                    return Ok(Some(result));
                }
            }
        }
        
        // Fallback to kdialog (KDE)
        if let Ok(output) = std::process::Command::new("kdialog")
            .args(&["--password", &message, "--title", &title])
            .output()
        {
            if output.status.success() {
                let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !result.is_empty() {
                    return Ok(Some(result));
                }
            }
        }
        
        Err("No suitable password dialog found. Please install zenity or kdialog.".to_string())
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Password input not supported on this platform".to_string())
    }
}


#[tauri::command]
async fn update_system_rclone() -> Result<i32, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command as SysCommand;

        fn quote_posix(value: &str) -> String {
            let escaped = value.replace("'", "'\\''");
            format!("'{}'", escaped)
        }

        let mut cmdline = String::from("PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH; ");
        cmdline.push_str(&quote_posix("rclone"));
        cmdline.push(' ');
        cmdline.push_str(&quote_posix("selfupdate"));

        // Escape for embedding inside an AppleScript string literal
        let applescript_cmd = cmdline.replace('\\', "\\\\").replace('"', "\\\"");
        let prompt = "Rclone UI needs permission to run rclone selfupdate.";
        let script = format!(
            "do shell script \"{}\" with administrator privileges with prompt \"{}\"",
            applescript_cmd,
            prompt.replace('"', "\\\"")
        );

        let status = SysCommand::new("osascript")
            .arg("-e")
            .arg(script)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(status.code().unwrap_or(0));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command as SysCommand;

        let path_env = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";

        // Try PolicyKit first (graphical auth prompt on most desktops)
        let mut pkexec_args: Vec<String> = Vec::new();
        pkexec_args.push("--description".to_string());
        pkexec_args.push("Rclone UI needs to run rclone selfupdate".to_string());
        pkexec_args.push("env".to_string());
        pkexec_args.push(path_env.to_string());
        pkexec_args.push("rclone".to_string());
        pkexec_args.push("selfupdate".to_string());

        match SysCommand::new("pkexec").args(&pkexec_args).status() {
            Ok(status) => return Ok(status.code().unwrap_or(0)),
            Err(_e) => {
                // Fallback to sudo with custom prompt (works if the user has NOPASSWD or cached credentials)
                let mut sudo_env = std::collections::HashMap::new();
                sudo_env.insert("SUDO_PROMPT", "Rclone UI needs permission to run rclone selfupdate. Please enter your password: ");
                
                let mut sudo_args: Vec<String> = Vec::new();
                sudo_args.push("-n".to_string());
                sudo_args.push("env".to_string());
                sudo_args.push(path_env.to_string());
                sudo_args.push("rclone".to_string());
                sudo_args.push("selfupdate".to_string());

                let status = SysCommand::new("sudo")
                    .envs(&sudo_env)
                    .args(&sudo_args)
                    .status()
                    .map_err(|e| e.to_string())?;
                return Ok(status.code().unwrap_or(0));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command as SysCommand;

        fn quote_ps(value: &str) -> String {
            // PowerShell single-quote escaping: ' -> ''
            format!("'{}'", value.replace('\'', "''"))
        }

        let file_path = quote_ps("rclone");
        let arg_list = String::from("@('selfupdate')");

        let ps_script = format!(
            "$p = Start-Process -Verb RunAs -WindowStyle Hidden -PassThru -FilePath {file} -ArgumentList {args}; \n\
            $p.WaitForExit();\n\
            exit $p.ExitCode",
            file = file_path,
            args = arg_list
        );

        let status = SysCommand::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(status.code().unwrap_or(0));
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let client = sentry::init((
        "https://7c7c55918ff850112780d2b2b29121a6@o4508503751983104.ingest.de.sentry.io/4508739164110928",
        sentry::ClientOptions {
            release: sentry::release_name!(),
            ..Default::default()
        },
    ));

    let _guard = minidump::init(&client);
	
    let mut app = tauri::Builder::default()
		.plugin(tauri_plugin_sentry::init_with_no_injection(&client))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![])))
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![unzip_file, get_arch, get_uid, prompt_password, stop_pid, update_system_rclone])
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
