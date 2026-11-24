"""Service-token check shared by every router. Only the Next.js app holds the token."""
import secrets

from fastapi import Header, HTTPException

from .config import get_settings


def auth(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(token, get_settings().service_token):
        raise HTTPException(401, "invalid service token")
