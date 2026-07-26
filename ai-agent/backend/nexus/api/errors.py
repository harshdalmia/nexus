"""Structured error envelope so the UI has exactly one shape to handle.

    { "error": { "code": "ACCOUNT_NOT_FOUND", "message": "...", "detail": {...} } }
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Raise anywhere in a request to emit the standard envelope."""

    def __init__(self, status: int, code: str, message: str, detail: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


def _envelope(code: str, message: str, detail: Any = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if detail is not None:
        err["detail"] = detail

    # Correlation id, so a failed call in the UI can be found in the server log.
    try:
        from .core.logging import current_request_id

        err["request_id"] = current_request_id()
    except Exception:  # pragma: no cover - never let logging break error reporting
        pass

    return {"error": err}


# Map bare HTTP status codes to stable machine codes for the UI.
_STATUS_CODES = {
    400: "BAD_REQUEST",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    429: "RATE_LIMITED",
    500: "INTERNAL",
    503: "WARMING_UP",
    504: "TIMEOUT",
}


def install(app) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status,
            content=_envelope(exc.code, exc.message, exc.detail),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        # pydantic puts the original exception object in `ctx`, which json cannot encode,
        # so the error list is coerced to primitives before it goes out.
        return JSONResponse(
            status_code=422,
            content=_envelope(
                "VALIDATION_ERROR", "Request body is invalid.",
                jsonable_encoder(exc.errors(), custom_encoder={Exception: str}),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = _STATUS_CODES.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(
            status_code=exc.status_code, content=_envelope(code, str(exc.detail))
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        # Never leak a stack trace to the UI; log-and-envelope instead.
        return JSONResponse(
            status_code=500,
            content=_envelope(
                "INTERNAL", "An unexpected error occurred while investigating.",
                {"type": type(exc).__name__},
            ),
        )
