# The compute SERVICE — receives jobs, downloads declared inputs, launches the runner
# container (--network none) via the host docker daemon, returns outputs. Needs the
# docker CLI + the host socket mounted (see README run command).
FROM python:3.12-slim

# docker-cli (not docker.io): the base is Debian trixie, where the CLI is its own package —
# docker.io alone installs WITHOUT /usr/bin/docker (found live on first deploy).
RUN apt-get update && apt-get install -y --no-install-recommends docker-cli ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir fastapi==0.115.* "uvicorn[standard]==0.32.*" httpx==0.27.* pydantic==2.*

WORKDIR /app
COPY main.py /app/main.py

EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
