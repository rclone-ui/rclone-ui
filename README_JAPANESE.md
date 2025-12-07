<h1 align="center">
  <a href="https://rcloneui.com">
    <img src="./public/banner.png" alt="Rclone UI" width="100%">
  </a>
  <br>
  <a href="https://rcloneui.com">
    Rclone のための cross-platform GUI
  </a>
</h1>

<h3 align="center">
  <strong><tt>rclone</tt> の上に載る軽量で透明なレイヤー。Remote とタスクを、もっと user-friendly に管理できます。</strong>
</h3>

<br />

<p align="center">
   <a href="https://github.com/rclone-ui/rclone-ui/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/actions/workflow/status/rclone-ui/rclone-ui/release.yml?style=for-the-badge" />
  </a>
  &nbsp;
  <a href="https://github.com/rclone-ui/rclone-ui?tab=readme-ov-file#downloads">
    <img alt="ダウンロード" src="https://img.shields.io/badge/ダウンロード-blue?style=for-the-badge&label=Tap%20to%20see" />
  </a>
  &nbsp;
  <a href="https://tauri.app/?ref=rclone-ui">
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-brown?style=for-the-badge&logo=rust&color=f85214" />
  </a>
</p>

<p align="center">
   <a href="#パッケージマネージャー">
    <img alt="Choco" src="https://img.shields.io/badge/Choco-42345f?style=for-the-badge&logo=chocolatey" />
  </a>
 &nbsp;
   <a href="#パッケージマネージャー">
    <img alt="Flathub" src="https://img.shields.io/badge/Flathub-000000?style=for-the-badge&logo=flathub" />
  </a>
 &nbsp;
   <a href="#パッケージマネージャー">
    <img alt="Homebrew" src="https://img.shields.io/badge/BREW-1f1d1a?style=for-the-badge&logo=homebrew" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/stargazers">
    <img alt="GitHub スター" src="https://img.shields.io/github/stars/rclone-ui/rclone-ui" />
  </a>
</p>

<br />

<a href="https://get.rcloneui.com/showcase">
  <img src=".github/rclone-video.png" alt="The GUI for Rclone">
</a>

## Docker/Homelab/サーバー利用
**リモート **`rclone`** インスタンスを管理する最も簡単な方法**で、サーバー、Homelab、家族の PC を管理しましょう。

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

#### Docker なしで使う
`rcd` デーモンを直接起動してください：

```bash
rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

#### 注意事項
- お好みの方法で **`rclone`** を起動したら、Rclone UI を開き Settings > Hosts に移動します。
- ファイアウォールやリバースプロキシ（nginx/caddy/traefik）でポート **`5572`** へのトラフィックを許可してください。
- Rclone UI は任意の RCD ポートに接続できるので、デフォルトの **`5572`** ポートをカスタマイズできます。
- 本番環境では **`--rc-no-auth`** の代わりに **`--rc-user`** と **`--rc-pass`** を使用してください。

## パッケージマネージャー
- Flathub **`flatpak install com.rcloneui.RcloneUI`** または **[ストアから](https://flathub.org/en/apps/com.rcloneui.RcloneUI)**
- Brew **`brew install --cask rclone-ui`**
- Scoop **`scoop bucket add extras`** と **`scoop install rclone-ui`**
- Chocolatey **`choco install rclone-ui`**
- WinGet **`winget install --id=RcloneUI.RcloneUI  -e`**
- NPM **`npx rclone-ui`**

## ダウンロード
- **Windows**（**[Arm](https://get.rcloneui.com/win-arm)**、**[x64](https://get.rcloneui.com/win)**）
- **macOS**（**[Apple Silicon](https://get.rcloneui.com/mac)**、**[Intel](https://get.rcloneui.com/mac64)**）
- **Linux**（**[AppImage](https://get.rcloneui.com/linux)**、**[deb](https://get.rcloneui.com/linux-deb)**、**[rpm](https://get.rcloneui.com/linux-rpm)**）
- **Linux `Arm`**（**[AppImage](https://get.rcloneui.com/linux-arm)**、**[deb](https://get.rcloneui.com/linux-deb-arm)**、**[rpm](https://get.rcloneui.com/linux-rpm-arm)**）

## ロードマップ
> 完了した項目は「機能」セクションに移動しました。
### [V3 のディスカッションをチェック](https://github.com/rclone-ui/rclone-ui/issues/37)

## 1 Star = インスタントコーヒー 1 杯
<a href="https://www.star-history.com/#rclone-ui/rclone-ui&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
   <img alt="スター履歴チャート" src="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
 </picture>
</a>

## コントリビューション
ようこそ、anon。お待ちしていました。

取り組むと良い課題はこちらです：
- オープンな [**Issue**](https://github.com/rclone-ui/rclone-ui/issues) を修正する
- リポジトリを Vite 7 と React 19 にアップグレードする
- React Compiler を導入する
- Cron ロジックを Rust に移行する

🎁 **マージされた PR にはライフタイムライセンスを贈呈！**

<br />

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README.md">
    <img alt="English" src="https://img.shields.io/badge/ENGLISH-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_CHINESE.md">
    <img alt="Chinese" src="https://img.shields.io/badge/CHINESE-gray?style=for-the-badge" />
  </a>
    <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_JAPANESE.md">
  <img alt="Japanese" src="https://img.shields.io/badge/JAPANESE-chartreuse?style=for-the-badge" />
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