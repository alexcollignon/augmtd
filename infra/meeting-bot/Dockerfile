FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

RUN apt-get update && apt-get install -y \
    pulseaudio \
    ffmpeg \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN playwright install chromium

COPY . .

RUN mkdir -p /data /tmp/recordings

RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
