from dataclasses import dataclass
from typing import Annotated, Callable, Optional

import firebase_admin
from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth, credentials

from .config import Settings, get_settings


@dataclass(frozen=True)
class AuthenticatedUser:
    uid: str
    email: Optional[str] = None


class FirebaseTokenVerifier:
    def __init__(self, settings: Settings):
        self.settings = settings
        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(
                credentials.ApplicationDefault(), {"projectId": settings.firebase_project_id}
            )

    def verify(self, token: str) -> AuthenticatedUser:
        try:
            decoded = auth.verify_id_token(token, check_revoked=True)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Firebase ID token",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Token has no UID")
        return AuthenticatedUser(uid=uid, email=decoded.get("email"))


def get_verifier(settings: Annotated[Settings, Depends(get_settings)]) -> FirebaseTokenVerifier:
    return FirebaseTokenVerifier(settings)


def bearer_token(authorization: Annotated[Optional[str], Header()] = None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def current_user(
    token: Annotated[str, Depends(bearer_token)],
    verifier: Annotated[FirebaseTokenVerifier, Depends(get_verifier)],
) -> AuthenticatedUser:
    return verifier.verify(token)


CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]
TokenVerifier = Callable[[str], AuthenticatedUser]

