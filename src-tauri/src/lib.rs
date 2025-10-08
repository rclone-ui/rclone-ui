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
use sysinfo::{System};
use tauri_plugin_sentry;
use sentry;

#[tauri::command]
fn is_tray_supported() -> bool {
    #[cfg(not(target_os = "linux"))]
    {
        return true;
    }

    #[cfg(target_os = "linux")]
    {
        use zbus::blocking::fdo::DBusProxy;
        use zbus::blocking::{Connection, Proxy};
        use zbus::names::BusName;

        let conn = match Connection::session() {
            Ok(c) => c,
            Err(_) => return false,
        };

        let dbus = match DBusProxy::new(&conn) {
            Ok(p) => p,
            Err(_) => return false,
        };

        let candidates = [
            "org.kde.StatusNotifierWatcher",
            "org.freedesktop.StatusNotifierWatcher",
        ];

        for name in candidates {
            let bus_name = match BusName::try_from(name) {
                Ok(n) => n,
                Err(_) => continue,
            };
            if dbus.name_has_owner(bus_name).unwrap_or(false) {
                // Try to read the property; if it fails but watcher exists, assume true
                if let Ok(proxy) = Proxy::new(&conn, name, "/StatusNotifierWatcher", "org.kde.StatusNotifierWatcher") {
                    if let Ok(registered) = proxy.get_property::<bool>("IsStatusNotifierHostRegistered") {
                        return registered;
                    }
                }
                return true;
            }
        }

        false
    }
}

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
fn is_rclone_running(port: Option<u16>) -> bool {

    if let Some(port) = port {
        use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
        use std::time::Duration;

        let timeout = Duration::from_millis(200);
        let addrs = [
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
            SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port),
        ];

        for addr in addrs.iter() {
            if let Ok(stream) = TcpStream::connect_timeout(addr, timeout) {
                drop(stream);
                return true;
            }
        }

        return false;
    }

    let system = System::new_all();
    for (_pid, process) in system.processes() {
        let name = process.name();
        let lower = name.to_ascii_lowercase();
        if lower == "rclone" || lower == "rclone.exe" {
            return true;
        }
    }
    false
}

#[tauri::command]
async fn stop_rclone_processes(timeout_ms: Option<u64>) -> Result<u32, String> {
    let timeout = timeout_ms.unwrap_or(5000);

    let system = System::new_all();

    // Collect PIDs first to avoid holding references across await points
    let mut pids: Vec<u32> = Vec::new();
    for (pid, process) in system.processes() {
        let name_lower = process.name().to_ascii_lowercase();
        if name_lower == "rclone" || name_lower == "rclone.exe" {
            pids.push(pid.as_u32());
        }
    }

    let mut stopped: u32 = 0;
    for pid in pids {
        match stop_pid(pid, Some(timeout)).await {
            Ok(()) => stopped += 1,
            Err(_e) => {}
        }
    }

    Ok(stopped)
}

#[tauri::command]
async fn prompt_password(title: String, message: String) -> Result<Option<String>, String> {
    prompt_text(title, message, None, Some(true)).await
}

#[tauri::command]
async fn prompt_text(
    title: String,
    message: String,
    default: Option<String>,
    sensitive: Option<bool>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let default_value = default.unwrap_or_default();
        let is_sensitive = sensitive.unwrap_or(false);
        let script = if is_sensitive {
            format!(
                r#"display dialog "{}" with title "{}" default answer "{}" with hidden answer"#,
                message.replace("\"", "\\\""),
                title.replace("\"", "\\\""),
                default_value.replace("\"", "\\\""),
            )
        } else {
            format!(
                r#"display dialog "{}" with title "{}" default answer "{}""#,
                message.replace("\"", "\\\""),
                title.replace("\"", "\\\""),
                default_value.replace("\"", "\\\""),
            )
        };

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout);
            // Parse AppleScript result: "text returned:VALUE, button returned:OK"
            if let Some(text_part) = result.split("text returned:").nth(1) {
                if let Some(value) = text_part.split(", button returned:").next() {
                    return Ok(Some(value.to_string()));
                }
            }
        }

        return Ok(None);
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        let default_value = default.unwrap_or_default();
        let is_sensitive = sensitive.unwrap_or(false);

        // Use PowerShell to create a simple text input dialog
        let ps_default = default_value.replace('\'', "''");
        let ps_title = title.replace('\'', "''");
        let ps_message = message.replace('\'', "''");
        let ps_password_flag = if is_sensitive { "$true" } else { "$false" };

        let powershell_script = format!(
            r#"
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing

            $form = New-Object System.Windows.Forms.Form
            $form.Text = '{title}'
            $form.Size = New-Object System.Drawing.Size(350, 180)
            $form.StartPosition = 'CenterScreen'
            $form.FormBorderStyle = 'FixedDialog'
            $form.MaximizeBox = $false
            $form.MinimizeBox = $false
            $form.TopMost = $true

            $label = New-Object System.Windows.Forms.Label
            $label.Location = New-Object System.Drawing.Point(10, 15)
            $label.Size = New-Object System.Drawing.Size(320, 40)
            $label.Text = '{message}'
            $form.Controls.Add($label)

            $textBox = New-Object System.Windows.Forms.TextBox
            $textBox.Location = New-Object System.Drawing.Point(10, 60)
            $textBox.Size = New-Object System.Drawing.Size(320, 20)
            $textBox.Text = '{default}'
            $textBox.UseSystemPasswordChar = {password}
            $form.Controls.Add($textBox)

            $okButton = New-Object System.Windows.Forms.Button
            $okButton.Location = New-Object System.Drawing.Point(175, 100)
            $okButton.Size = New-Object System.Drawing.Size(75, 23)
            $okButton.Text = 'OK'
            $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.AcceptButton = $okButton
            $form.Controls.Add($okButton)

            $cancelButton = New-Object System.Windows.Forms.Button
            $cancelButton.Location = New-Object System.Drawing.Point(255, 100)
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
            title = ps_title,
            message = ps_message,
            default = ps_default,
            password = ps_password_flag
        );

        let output = Command::new("powershell")
            .args(&["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &powershell_script])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !result.is_empty() || !default_value.is_empty() {
                return Ok(Some(result));
            }
        }

        return Ok(None);
    }

    #[cfg(target_os = "linux")]
    {
        let default_value = default.unwrap_or_default();
        let is_sensitive = sensitive.unwrap_or(false);

        if is_sensitive {
            // Try zenity password dialog first
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

            // Fallback to kdialog password
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

            return Err("No suitable password dialog found. Please install zenity or kdialog.".to_string());
        } else {
            // Try zenity text entry first
            if let Ok(output) = std::process::Command::new("zenity")
                .args(&["--entry", "--title", &title, "--text", &message, "--entry-text", &default_value])
                .output()
            {
                if output.status.success() {
                    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    return Ok(Some(result));
                }
            }

            // Fallback to kdialog input box
            if let Ok(output) = std::process::Command::new("kdialog")
                .args(&["--inputbox", &message, &default_value, "--title", &title])
                .output()
            {
                if output.status.success() {
                    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    return Ok(Some(result));
                }
            }

            return Err("No suitable input dialog found. Please install zenity or kdialog.".to_string());
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Text input not supported on this platform".to_string())
    }
}

#[tauri::command]
async fn test_proxy_connection(proxy_url: String) -> Result<String, String> {
    use std::time::Duration;

    // Validate
    let proxy_url = proxy_url.trim();
    if proxy_url.is_empty() {
        return Err("Proxy URL cannot be empty".to_string());
    }

    // Build client with proxy
    let proxy = reqwest::Proxy::all(proxy_url)
        .map_err(|e| format!("Invalid proxy URL: {}", e))?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Multiple fallback endpoints
    let candidates = [
        "https://httpbin.org/ip",
        "https://www.cloudflare.com/cdn-cgi/trace",
        "https://ifconfig.me/ip",
        "https://1.1.1.1/cdn-cgi/trace",
    ];

    let mut last_error: Option<String> = None;
    for url in candidates.iter() {
        match client.get(*url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.text().await {
                        Ok(body) => {
                            return Ok(format!("Connected via proxy. Endpoint: {}. Snippet: {}", url, body.chars().take(200).collect::<String>()))
                        }
                        Err(e) => {
                            last_error = Some(format!("Failed to read response from {}: {}", url, e));
                            continue;
                        }
                    }
                } else {
                    last_error = Some(format!("{} responded with status {}", url, resp.status()));
                    continue;
                }
            }
            Err(e) => {
                last_error = Some(format!("Request to {} failed: {}", url, e));
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "All proxy tests failed".to_string()))
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

    let _guard = tauri_plugin_sentry::minidump::init(&client);
	
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
		.plugin(tauri_plugin_prevent_default::debug())
		.invoke_handler(tauri::generate_handler![unzip_file, get_arch, get_uid, is_rclone_running, stop_rclone_processes, prompt_password, prompt_text, stop_pid, update_system_rclone, test_proxy_connection, is_tray_supported])
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
