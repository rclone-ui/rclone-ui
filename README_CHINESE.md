<h1 align="center">
  <a href="https://rcloneui.com">
    <img src="./public/banner.png" alt="Rclone UI" width="100%">
  </a>
  <br>
  <a href="https://rcloneui.com">
    Rclone 的跨平台 GUI
  </a>
</h1>

<h3 align="center">
  <strong>在 <tt>rclone</tt> 之上提供一层轻量、透明的界面，用更友好的方式管理你的 Remotes &amp; 任务。</strong>
</h3>

<br />

<p align="center">
   <a href="https://github.com/rclone-ui/rclone-ui/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/actions/workflow/status/rclone-ui/rclone-ui/release.yml?style=for-the-badge" />
  </a>
  &nbsp;
  <a href="https://github.com/rclone-ui/rclone-ui?tab=readme-ov-file#downloads">
    <img alt="下载" src="https://img.shields.io/badge/下载-blue?style=for-the-badge&label=Tap%20to%20see" />
  </a>
  &nbsp;
  <a href="https://tauri.app/?ref=rclone-ui">
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-brown?style=for-the-badge&logo=rust&color=f85214" />
  </a>
</p>

<p align="center">
   <a href="#包管理器">
    <img alt="Choco" src="https://img.shields.io/badge/Choco-42345f?style=for-the-badge&logo=chocolatey" />
  </a>
 &nbsp;
   <a href="#包管理器">
    <img alt="Flathub" src="https://img.shields.io/badge/Flathub-000000?style=for-the-badge&logo=flathub" />
  </a>
 &nbsp;
   <a href="#包管理器">
    <img alt="Homebrew" src="https://img.shields.io/badge/BREW-1f1d1a?style=for-the-badge&logo=homebrew" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/stargazers">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/rclone-ui/rclone-ui" />
  </a>
</p>

<br />

<a href="https://get.rcloneui.com/showcase">
  <img src=".github/rclone-video.png" alt="The GUI for Rclone">
</a>

## Docker/Homelab/服务器使用
使用 **最简单的方式** 管理远程 **`rclone`** 实例，控制你的服务器、Homelab 或家人的电脑。

#### Docker Compose
```yaml
services:
  rclone:
    image: rclone/rclone
    container_name: rclone
    command: rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
    ports:
      - 5572:5572
    volumes:
      - ./config:/config/rclone
      - /path/to/data:/data
```

#### Docker CLI
```bash
docker run -d \
  --name rclone \
  -p 5572:5572 \
  -v ./config:/config/rclone \
  -v /path/to/data:/data \
  rclone/rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

#### 不使用 Docker
直接启动 `rcd` 守护进程：

```bash
rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

#### 注意事项
- 使用你喜欢的方式启动 **`rclone`** 后，打开 Rclone UI 并导航到 Settings > Hosts。
- 确保在防火墙和/或反向代理（nginx/caddy/traefik）中允许端口 **`5572`** 的流量。
- Rclone UI 可以连接到任意 RCD 端口，你可以自定义默认的 **`5572`** 端口。
- 在生产环境中使用 **`--rc-user`** 和 **`--rc-pass`** 而不是 **`--rc-no-auth`**。

## 包管理器
- Flathub **`flatpak install com.rcloneui.RcloneUI`** 或 **[从商店获取](https://flathub.org/en/apps/com.rcloneui.RcloneUI)**
- Brew **`brew install --cask rclone-ui`**
- Scoop **`scoop bucket add extras`** & **`scoop install rclone-ui`**
- Chocolatey **`choco install rclone-ui`**
- WinGet **`winget install --id=RcloneUI.RcloneUI  -e`**
- NPM **`npx rclone-ui`**

## 下载
- **Windows**（**[Arm](https://get.rcloneui.com/win-arm)**、**[x64](https://get.rcloneui.com/win)**）
- **macOS**（**[Apple Silicon](https://get.rcloneui.com/mac)**、**[Intel](https://get.rcloneui.com/mac64)**）
- **Linux**（**[AppImage](https://get.rcloneui.com/linux)**、**[deb](https://get.rcloneui.com/linux-deb)**、**[rpm](https://get.rcloneui.com/linux-rpm)**）
- **Linux `Arm`**（**[AppImage](https://get.rcloneui.com/linux-arm)**、**[deb](https://get.rcloneui.com/linux-deb-arm)**、**[rpm](https://get.rcloneui.com/linux-rpm-arm)**）

## 路线图
> 已完成的内容已移至「功能」部分。
### [来看看 V3 的讨论！](https://github.com/rclone-ui/rclone-ui/issues/37)

## 1 Star = 1 杯速溶咖啡
<a href="https://www.star-history.com/#rclone-ui/rclone-ui&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
   <img alt="Star 历史图表" src="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
 </picture>
</a>

## 参与贡献
欢迎，anon。我们一直在等你。

以下是一些值得解决的问题：
- 修复一个 [**Issue**](https://github.com/rclone-ui/rclone-ui/issues)
- 将仓库升级到 Vite 7 和 React 19
- 引入 React Compiler
- 将 Cron 逻辑迁移到 Rust

🎁 **合并的 PR 可获终身许可证！**

<br />

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README.md">
  	<img alt="English" src="https://img.shields.io/badge/ENGLISH-gray?style=for-the-badge" />
  </a>
    <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_CHINESE.md">
  <img alt="Chinese" src="https://img.shields.io/badge/CHINESE-chartreuse?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_JAPANESE.md">
		<img alt="Japanese" src="https://img.shields.io/badge/JAPANESE-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_POLISH.md">
		<img alt="Polish" src="https://img.shields.io/badge/POLISH-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_GERMAN.md">
		<img alt="German" src="https://img.shields.io/badge/GERMAN-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_SPANISH.md">
		<img alt="Spanish" src="https://img.shields.io/badge/SPANISH-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_ROMANIAN.md">
		<img alt="Romanian" src="https://img.shields.io/badge/ROMANIAN-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_PIRATE.md">
		<img alt="Pirate" src="https://img.shields.io/badge/PIRATE-gray?style=for-the-badge" />
  </a>
</p>