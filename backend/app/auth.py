"""
Authentication dependencies for FastAPI routes.

Uses Supabase Auth to verify JWT access tokens from the Authorization header.
"""

import logging
import os
from fastapi import Depends, HTTPException, Header

from app.database import supabase

logger = logging.getLogger("auth")

ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")


async def get_current_user(authorization: str = Header(...)) -> dict:
    """
    Verify the Supabase JWT and return the authenticated user.

    Expects: Authorization: Bearer <access_token>
    Returns: {"id": "<user_id>", "email": "<email>", ...}
    Raises: 401 if token is missing/invalid, user not found.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Missing access token")

    try:
        user_response = supabase.auth.get_user(token)
        user = user_response.user

        if not user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        return {"id": user.id, "email": user.email}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Auth verification failed: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def require_same_user(user_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    """Verify the authenticated user matches the requested user_id."""
    if current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return current_user


async def require_admin(x_admin_key: str = Header(None, alias="X-Admin-Key")) -> None:
    """
    Protect admin-only endpoints with a shared secret.

    Expects: X-Admin-Key header matching ADMIN_API_KEY env var.
    If ADMIN_API_KEY is not set, the endpoint is unrestricted (dev mode).
    """
    if not ADMIN_API_KEY:
        return

    if x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Admin access required")
