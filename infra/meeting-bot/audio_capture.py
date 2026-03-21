import asyncio
import logging
import os
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Ensure PulseAudio subprocesses inherit the correct runtime dir (needed for root in Docker)
_PULSE_ENV = {
    **os.environ,
    'HOME': '/root',
    'XDG_RUNTIME_DIR': '/run/user/0',
}


class AudioCapture:
    def __init__(self, bot_id: str, output_path: str):
        self.bot_id = bot_id
        self.output_path = output_path
        self.sink_name = f"augmtd_{bot_id.replace('-', '_')}"
        self.module_index: Optional[str] = None
        self.ffmpeg_proc: Optional[subprocess.Popen] = None

    def get_pulse_sink(self) -> str:
        return self.sink_name

    async def create_sink(self) -> None:
        """Create PulseAudio null sink (call before browser launch)."""
        result = subprocess.run(
            ['pactl', 'load-module', 'module-null-sink', f'sink_name={self.sink_name}'],
            capture_output=True,
            text=True,
            env=_PULSE_ENV,
        )
        if result.returncode != 0:
            raise RuntimeError(f'pactl load-module failed: {result.stderr}')
        self.module_index = result.stdout.strip()
        logger.info(f'[AudioCapture] Loaded PulseAudio sink {self.sink_name} (module {self.module_index})')

    async def start_recording(self) -> None:
        """Start ffmpeg recording (call after bot is admitted to call)."""
        monitor_source = f'{self.sink_name}.monitor'
        self.ffmpeg_proc = subprocess.Popen(
            [
                'ffmpeg', '-y',
                '-f', 'pulse',
                '-i', monitor_source,
                '-c:a', 'libopus',
                '-b:a', '64k',
                '-vbr', 'on',
                self.output_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=_PULSE_ENV,
        )
        logger.info(f'[AudioCapture] ffmpeg started (pid {self.ffmpeg_proc.pid}) → {self.output_path}')

        await asyncio.sleep(2)
        if self.ffmpeg_proc.poll() is not None:
            stderr = self.ffmpeg_proc.stderr.read().decode()
            raise RuntimeError(f'ffmpeg exited early: {stderr}')

    async def setup(self) -> None:
        """Create sink + start ffmpeg (legacy: used for compatibility)."""
        await self.create_sink()
        await self.start_recording()

    async def stop(self) -> None:
        """Terminate ffmpeg and unload the PulseAudio sink."""
        if self.ffmpeg_proc and self.ffmpeg_proc.poll() is None:
            logger.info(f'[AudioCapture] Stopping ffmpeg (pid {self.ffmpeg_proc.pid})')
            self.ffmpeg_proc.terminate()
            try:
                await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(None, self.ffmpeg_proc.wait),
                    timeout=10,
                )
            except asyncio.TimeoutError:
                logger.warning('[AudioCapture] ffmpeg did not terminate in 10s — sending SIGKILL')
                self.ffmpeg_proc.kill()
                await asyncio.get_event_loop().run_in_executor(None, self.ffmpeg_proc.wait)

        if self.module_index:
            result = subprocess.run(
                ['pactl', 'unload-module', self.module_index],
                capture_output=True,
                text=True,
                env=_PULSE_ENV,
            )
            if result.returncode != 0:
                logger.warning(f'[AudioCapture] pactl unload-module failed: {result.stderr}')
            else:
                logger.info(f'[AudioCapture] Unloaded PulseAudio module {self.module_index}')
