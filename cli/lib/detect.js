import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getPlatform } from "./platform.js";

export function getInstallPath() {
    const { isMac, isWindows, isLinux } = getPlatform();

    if (isMac) {
        return "/Applications/Rclone UI.app";
    }

    if (isWindows) {
        // NSIS installs to %LOCALAPPDATA%\Rclone UI
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        return path.join(localAppData, "Rclone UI", "Rclone UI.exe");
    }

    if (isLinux) {
        // AppImage installed to ~/.local/bin
        return path.join(os.homedir(), ".local", "bin", "rclone-ui");
    }

    return null;
}

export function isInstalled() {
    const installPath = getInstallPath();
    if (!installPath) return false;

    try {
        return fs.existsSync(installPath);
    } catch {
        return false;
    }
}

