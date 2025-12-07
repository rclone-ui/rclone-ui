import { spawn } from "node:child_process";
import { getPlatform } from "./platform.js";
import { getInstallPath } from "./detect.js";

export function openApp() {
    const { isMac, isWindows, isLinux } = getPlatform();
    const installPath = getInstallPath();

    return new Promise((resolve, reject) => {
        let child;

        if (isMac) {
            child = spawn("open", ["-a", "Rclone UI"], {
                detached: true,
                stdio: "ignore",
            });
        } else if (isWindows) {
            child = spawn(installPath, [], {
                detached: true,
                stdio: "ignore",
                shell: true,
            });
        } else if (isLinux) {
            child = spawn(installPath, [], {
                detached: true,
                stdio: "ignore",
            });
        } else {
            reject(new Error("Unsupported platform"));
            return;
        }

        child.unref();
        child.on("error", reject);

        // Give it a moment to spawn, then resolve
        setTimeout(() => resolve(), 500);
    });
}

