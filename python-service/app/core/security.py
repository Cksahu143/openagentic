"""
Auth for the JS <-> Python bridge.

This service is never exposed directly to end users — only OpenAgent's TS
server (src/lib/python-bridge.server.ts) calls it, server-to-server, with a
shared secret. There is no per-end-user auth here; user identity/RLS is
still enforced upstream by Supabase on the TS side. The TS side forwards the
authenticated `userId` in the request body purely for logging/scoping
Python-side memory, not as an auth mechanism.
"""
import hmac

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


async def verify_bridge_token(
    x_openagent_bridge_token: str = Header(default=""),
) -> None:
    settings = get_settings()
    expected = settings.bridge_shared_secret
    if not expected or not hmac.compare_digest(x_openagent_bridge_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bridge token",
        )
