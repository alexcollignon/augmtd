#!/bin/bash
set -e

# PulseAudio needs XDG_RUNTIME_DIR when running as root in Docker
export HOME=/root
export XDG_RUNTIME_DIR=/run/user/0
mkdir -p "$XDG_RUNTIME_DIR"

# Kill any stale PulseAudio instance from previous run
pulseaudio --kill 2>/dev/null || true
rm -f /run/user/0/pulse/pid 2>/dev/null || true
sleep 1

pulseaudio --start --exit-idle-time=-1
sleep 2

# Remove stale Xvfb lock if present (can happen on container restart)
rm -f /tmp/.X99-lock

Xvfb :99 -screen 0 1280x720x24 &
sleep 1

export DISPLAY=:99

exec uvicorn main:app --host 0.0.0.0 --port 3001
