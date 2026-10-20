from __future__ import annotations

import hmac
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


def valid_bearer_token(expected: str, authorization: str) -> bool:
    scheme, separator, supplied = authorization.partition(" ")
    return bool(
        separator
        and scheme.casefold() == "bearer"
        and hmac.compare_digest(supplied, expected)
    )


def install_access_control(app: FastAPI) -> None:
    @app.middleware("http")
    async def require_service_token(request: Request, call_next):
        expected = os.getenv("SERVICE_API_TOKEN", "")
        if expected and request.url.path != "/health" and request.method != "OPTIONS":
            if not valid_bearer_token(expected, request.headers.get("authorization", "")):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "A valid bearer token is required."},
                    headers={"WWW-Authenticate": "Bearer"},
                )
        return await call_next(request)
