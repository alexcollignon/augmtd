import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(
    jobstores={
        'default': SQLAlchemyJobStore(url='sqlite:////data/scheduler.db')
    }
)


def schedule_bot(bot_id: str, run_at) -> None:
    """Schedule run_bot(bot_id) to fire at run_at (datetime). Fires immediately if run_at is in the past."""
    from bot_runner import run_bot

    scheduler.add_job(
        run_bot,
        trigger='date',
        run_date=run_at,
        args=[bot_id],
        id=f'bot_{bot_id}',
        replace_existing=True,
        misfire_grace_time=300,  # fire up to 5 min late if scheduler was down
    )
    logger.info(f'[Scheduler] Scheduled bot {bot_id} to run at {run_at}')
