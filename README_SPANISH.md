<h1 align="center">
  <a href="https://rcloneui.com">
    <img src="./public/banner.png" alt="Rclone UI" width="100%">
  </a>
  <br>
  <a href="https://rcloneui.com">
    La GUI multiplataforma para Rclone
  </a>
</h1>

<h3 align="center">
  <strong>Una capa ligera y transparente sobre <tt>rclone</tt> para gestionar tus Remotes &amp; tareas de forma más amigable.</strong>
</h3>

<br />

<p align="center">
   <a href="https://github.com/rclone-ui/rclone-ui/releases/latest">
    <img alt="Latest Release" src="https://img.shields.io/github/actions/workflow/status/rclone-ui/rclone-ui/release.yml?style=for-the-badge" />
  </a>
  &nbsp;
  <a href="https://github.com/rclone-ui/rclone-ui?tab=readme-ov-file#downloads">
    <img alt="Descargas" src="https://img.shields.io/badge/DESCARGAS-blue?style=for-the-badge&label=Tap%20to%20see" />
  </a>
  &nbsp;
  <a href="https://tauri.app/?ref=rclone-ui">
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-brown?style=for-the-badge&logo=rust&color=f85214" />
  </a>
</p>

<p align="center">
   <a href="#package-managers">
    <img alt="Choco" src="https://img.shields.io/badge/Choco-42345f?style=for-the-badge&logo=chocolatey" />
  </a>
 &nbsp;
   <a href="#package-managers">
    <img alt="Flathub" src="https://img.shields.io/badge/Flathub-000000?style=for-the-badge&logo=flathub" />
  </a>
 &nbsp;
   <a href="#package-managers">
    <img alt="Homebrew" src="https://img.shields.io/badge/BREW-1f1d1a?style=for-the-badge&logo=homebrew" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/stargazers">
    <img alt="Estrellas del repositorio en GitHub" src="https://img.shields.io/github/stars/rclone-ui/rclone-ui" />
  </a>
</p>

<br />

<a href="https://get.rcloneui.com/showcase">
  <img src=".github/rclone-video.png" alt="The GUI for Rclone">
</a>

## Docker/Homelab/Servidor
Controla tu servidor, homelab o el PC de tu madre con **la solución más fácil para gestionar instancias remotas de **`rclone`**.**

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

#### Sin Docker
Simplemente inicia el daemon `rcd` directamente:

```bash
rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

#### Notas
- Después de iniciar **`rclone`** usando tu método preferido, abre Rclone UI y navega a Settings > Hosts.
- Asegúrate de permitir el tráfico en el puerto **`5572`** en tu firewall y/o proxy inverso (nginx/caddy/traefik).
- Rclone UI puede conectarse a cualquier puerto RCD, por lo que puedes personalizar el puerto predeterminado **`5572`**.
- Usa **`--rc-user`** y **`--rc-pass`** en lugar de **`--rc-no-auth`** en producción.

## Package Managers
- Flathub **`flatpak install com.rcloneui.RcloneUI`** o **[desde la tienda](https://flathub.org/en/apps/com.rcloneui.RcloneUI)**
- Brew **`brew install --cask rclone-ui`**
- Scoop **`scoop bucket add extras`** & **`scoop install rclone-ui`**
- Chocolatey **`choco install rclone-ui`**
- WinGet **`winget install --id=RcloneUI.RcloneUI  -e`**
- NPM **`npx rclone-ui`**

## Descargas
- **Windows** (**[Arm](https://get.rcloneui.com/win-arm)**, **[x64](https://get.rcloneui.com/win)**)
- **macOS** (**[Apple Silicon](https://get.rcloneui.com/mac)**, **[Intel](https://get.rcloneui.com/mac64)**)
- **Linux** (**[AppImage](https://get.rcloneui.com/linux)**, **[deb](https://get.rcloneui.com/linux-deb)**, **[rpm](https://get.rcloneui.com/linux-rpm)**)
- **Linux `Arm`** (**[AppImage](https://get.rcloneui.com/linux-arm)**, **[deb](https://get.rcloneui.com/linux-deb-arm)**, **[rpm](https://get.rcloneui.com/linux-rpm-arm)**)

## Hoja de ruta
> Los elementos finalizados se han movido a la sección «Funciones».
### ¡Echa un vistazo a la discusión de la V3!](https://github.com/rclone-ui/rclone-ui/issues/37)

## 1 estrella = 1 café instantáneo
<a href="https://www.star-history.com/#rclone-ui/rclone-ui&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
   <img alt="Gráfico del historial de estrellas" src="https://api.star-history.com/svg?repos=rclone-ui/rclone-ui&type=Timeline" />
 </picture>
</a>

## Contribuciones
Bienvenido, anon. Te estábamos esperando.

Aquí tienes algunos retos interesantes:
- Arregla un [**Issue**](https://github.com/rclone-ui/rclone-ui/issues) abierto
- Actualiza el repositorio a Vite 7 y React 19
- Introduce React Compiler
- Mueve la lógica de Cron a Rust

🎁 **¡Los PR fusionados reciben una licencia de por vida!**

<br />

<p align="center">
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README.md">
    <img alt="English" src="https://img.shields.io/badge/ENGLISH-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_CHINESE.md">
    <img alt="Chinese" src="https://img.shields.io/badge/CHINESE-gray?style=for-the-badge" />
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
  <img alt="Spanish" src="https://img.shields.io/badge/SPANISH-chartreuse?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_ROMANIAN.md">
    <img alt="Romanian" src="https://img.shields.io/badge/ROMANIAN-gray?style=for-the-badge" />
  </a>
  <a href="https://github.com/rclone-ui/rclone-ui/blob/main/README_PIRATE.md">
    <img alt="Pirate" src="https://img.shields.io/badge/PIRATE-gray?style=for-the-badge" />
  </a>
</p>