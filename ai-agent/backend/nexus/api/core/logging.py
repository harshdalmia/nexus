"""Request logging with a correlation id.

Every response carries `X-Request-Id`. The same id prefixes the access log line and is
echoed in error envelopes, so a screenshot of a failed UI call is enough to find the
server-side record of it.
"""

from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

REQUEST_ID_HEADER = "X-Request-Id"
_request_id: ContextVar[str] = ContextVar("nexus_request_id", default="-")

logger = logging.getLogger("nexus.api")


def current_request_id() -> str:
    return _request_id.get()


def configure_logging(level: str = "INFO") -> None:
    """Idempotent root handler setup. Uvicorn owns its own loggers; we only add ours."""
    if logger.handlers:
        logger.setLevel(level)
        return

    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s %(name)s %(message)s", "%H:%M:%S")
    )
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign/propagate a request id and log one line per request with its duration."""

    def __init__(self, app, log_requests: bool = True):
        super().__init__(app)
        self.log_requests = log_requests

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming or uuid.uuid4().hex[:12]
        token = _request_id.set(request_id)
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            elapsed = (time.perf_counter() - started) * 1000.0
            logger.exception(
                "[%s] %s %s -> unhandled in %.1fms",
                request_id, request.method, request.url.path, elapsed,
            )
            raise
        finally:
            _request_id.reset(token)

        elapsed = (time.perf_counter() - started) * 1000.0
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["X-Response-Time-Ms"] = f"{elapsed:.1f}"

        if self.log_requests:
            level = logging.WARNING if response.status_code >= 500 else logging.INFO
            logger.log(
                level, "[%s] %s %s -> %d in %.1fms",
                request_id, request.method, request.url.path,
                response.status_code, elapsed,
            )

        return response
