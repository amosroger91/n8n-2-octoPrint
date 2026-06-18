# ============================================================================
# slicer — headless OrcaSlicer + a tiny POST /slice API (STL/3MF -> gcode).
#
# Runs at each print site next to the orchestrator. No desktop, no GUI, no
# video streaming — just OrcaSlicer's CLI under an offscreen Qt platform.
#
# Layers are ordered so the heavy, rarely-changing bits (the ~400 MB AppImage)
# cache independently of the runtime-deps list and the app code.
# ============================================================================
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    QT_QPA_PLATFORM=offscreen \
    ORCA_DATADIR=/data/orca \
    HOME=/data/orca

# --- 1. minimal tools to fetch the AppImage (cached separately from deps) ----
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# --- 2. download + extract OrcaSlicer (--appimage-extract: no FUSE needed) ----
# Pin a known-good release; override at build time with --build-arg ORCA_URL=...
ARG ORCA_URL=https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.2/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.2.AppImage
RUN curl -fSL -o /tmp/orca.AppImage "$ORCA_URL" \
    && chmod +x /tmp/orca.AppImage \
    && cd /opt && /tmp/orca.AppImage --appimage-extract >/dev/null \
    && mv squashfs-root orcaslicer \
    && ln -sf /opt/orcaslicer/AppRun /usr/local/bin/orca-slicer \
    && rm /tmp/orca.AppImage

# --- 3. runtime libs OrcaSlicer's headless CLI needs on Ubuntu 24.04 + Node --
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 libglu1-mesa libegl1 libopengl0 libgomp1 \
        libgtk-3-0t64 libwebkit2gtk-4.1-0 \
        libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
        libsecret-1-0 libnss3 libnspr4 libdbus-1-3 \
        libsm6 libice6 libmspack0 \
        libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
        libxcb-render-util0 libxcb-xinerama0 libxkbcommon-x11-0 \
        fontconfig fonts-dejavu-core locales mesa-utils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- 4. the slice API ---------------------------------------------------------
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./

RUN mkdir -p /data/orca && chmod -R 777 /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1
CMD ["node", "server.mjs"]
