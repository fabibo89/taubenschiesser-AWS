"""
In-memory Hugin stitch job store (single-process CV service).
"""
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

MAX_LOG_LINES = 80

_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_job() -> str:
    job_id = str(uuid.uuid4())
    with _lock:
        _jobs[job_id] = {
            'job_id': job_id,
            'status': 'queued',
            'progress': 0,
            'step': 'queued',
            'step_label': 'Warteschlange',
            'message': None,
            'logs': [],
            'result': None,
            'error': None,
            'error_code': None,
            'created_at': _utc_now(),
            'updated_at': _utc_now(),
        }
    return job_id


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def _append_log(job_id: str, line: str) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        logs: List[str] = job['logs']
        logs.append(line)
        if len(logs) > MAX_LOG_LINES:
            del logs[: len(logs) - MAX_LOG_LINES]
        job['updated_at'] = _utc_now()


def update_job(job_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)
        job['updated_at'] = _utc_now()


def make_progress_callback(job_id: str) -> Callable[[Dict[str, Any]], None]:
    def on_progress(update: Dict[str, Any]) -> None:
        message = update.get('message')
        if message:
            _append_log(job_id, message)
        update_fields = {
            'status': 'running',
            'progress': update.get('progress', 0),
            'step': update.get('step', ''),
            'step_label': update.get('step_label', ''),
        }
        if message:
            update_fields['message'] = message
        update_job(job_id, **update_fields)

    return on_progress


def start_job_thread(job_id: str, target: Callable[[], None]) -> None:
    def runner():
        update_job(job_id, status='running', step='starting', step_label='Starte Hugin…', progress=1)
        try:
            target()
        except Exception as e:
            error_code = getattr(e, 'error_code', None)
            update_job(
                job_id,
                status='error',
                progress=0,
                step='error',
                step_label='Fehler',
                error=str(e),
                error_code=error_code,
            )

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
