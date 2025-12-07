<h1 align="center">
  <a href="https://rcloneui.com">
    <img src="https://raw.githubusercontent.com/rclone-ui/rclone-ui/main/public/banner.png" alt="Rclone UI" width="100%">
  </a>
  <br>
  <a href="https://rcloneui.com">
    The cross-platform GUI for Rclone
  </a>
</h1>

Tnstalls and launches [**Rclone UI**](https://rcloneui.com).

## Usage

```bash
npx rclone-ui
```

That's it!

If Rclone UI is already installed, it opens the app. If not, it downloads the latest release from GitHub and installs it.

## Options

```bash
npx rclone-ui              # Open Rclone UI (installs if not found)
npx rclone-ui --install    # Reinstall (or update)
npx rclone-ui --version    # Show version
npx rclone-ui --help       # Show help
```

## How it works

- **macOS**: Mounts the `.dmg` and copies the app to `/Applications`
- **Windows**: Runs the NSIS installer in silent mode
- **Linux**: Installs the AppImage to `~/.local/bin`

## Links

- [Website](https://rcloneui.com)
- [GitHub](https://github.com/rclone-ui/rclone-ui)
- [Releases](https://github.com/rclone-ui/rclone-ui/releases)
