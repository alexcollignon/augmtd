# The Hetzner transcription service (in-person recordings → local Whisper → generate-insights).
# Sep 23: the auto-join Meet bot was removed, so the Playwright/Chromium base image, PulseAudio,
# Xvfb and the entrypoint that started them are gone. ffmpeg stays — transcription_worker.py
# remuxes browser WebM recordings (adds the duration header) before sending them to Whisper.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /tmp/recordings

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001"]
