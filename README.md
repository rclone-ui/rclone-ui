# Issue & Goal
- opening the app in release mode does not show the tray icon or do anything
- tauri looks to be working and sending the `applicationDidFinishLaunching` event but nothing happens
- the goal is to have this run on macOS (no sandboxing needed)


# Notes
### Overall
- you will have to download the `rclone` binary from the [rclone website](https://rclone.org/downloads/) and put it in the `src-tauri/binaries` directory. if you already have rclone installed, it will be used instead of the binary.
- the main window runs the `main.ts` file that's at the project root, it is not related to the vite app. it gets compiled by the `buildExternal.js` script and added to the vite bundle through the `public` directory.
- sometimes `rclone` binary does not start correctly and the loading tray icons is stuck forever, i'd like to solve that too but this is more of a notice to restart the app if that happens

### Tauri Info
[✔] Environment
    - OS: Mac OS 14.7.2 arm64 (X64)
    ✔ Xcode Command Line Tools: installed
    ✔ rustc: 1.82.0 (f6e511eec 2024-10-15)
    ✔ cargo: 1.82.0 (8f40fc59f 2024-08-21)
    ✔ rustup: 1.27.1 (54dd3d00f 2024-04-24)
    ✔ Rust toolchain: stable-aarch64-apple-darwin (default)
    - node: 20.8.1
    - npm: 10.1.0

[-] Packages
    - tauri 🦀: 2.2.0
    - tauri-build 🦀: 2.0.4
    - wry 🦀: 0.48.0
    - tao 🦀: 0.31.1
    - @tauri-apps/api : 2.2.0
    - @tauri-apps/cli : 2.2.5

[-] Plugins
    - tauri-plugin-log 🦀: 2.2.0
    - @tauri-apps/plugin-log : 2.2.0
    - tauri-plugin-notification 🦀: 2.2.0
    - @tauri-apps/plugin-notification : 2.2.1
    - tauri-plugin-process 🦀: 2.2.0
    - @tauri-apps/plugin-process : 2.2.0
    - tauri-plugin-http 🦀: 2.2.0
    - @tauri-apps/plugin-http : 2.2.0
    - tauri-plugin-store 🦀: 2.2.0
    - @tauri-apps/plugin-store : 2.2.0
    - tauri-plugin-os 🦀: 2.2.0
    - @tauri-apps/plugin-os : 2.2.0
    - tauri-plugin-shell 🦀: 2.2.0
    - @tauri-apps/plugin-shell : 2.2.0
    - tauri-plugin-single-instance 🦀: 2.2.0
    - @tauri-apps/plugin-single-instance : not installed!
    - tauri-plugin-dialog 🦀: 2.2.0
    - @tauri-apps/plugin-dialog : 2.2.0
    - tauri-plugin-fs 🦀: 2.2.0
    - @tauri-apps/plugin-fs : 2.2.0
    - tauri-plugin-opener 🦀: 2.2.3
    - @tauri-apps/plugin-opener : 2.2.5
    - tauri-plugin-positioner 🦀: 2.2.0
    - @tauri-apps/plugin-positioner : 2.2.0

[-] App
    - build-type: bundle
    - CSP: unset
    - frontendDist: ../dist
    - devUrl: http://localhost:1420/
    - framework: React
    - bundler: Vite