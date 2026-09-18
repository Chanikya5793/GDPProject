from dataclasses import dataclass
from typing import Annotated, Callable, Optional

import firebase_admin
from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth, credentials

from .config import Settings, get_settings
from .signup_policy import SignupPolicy, get_signup_policy


@dataclass(frozen=True)
class AuthenticatedUser:
    uid: str
    email: Optional[str] = None


class Forbidden(Exception):
    """A valid token whose holder may not do this, with a code the clients key on.

    HTTPException carries only a detail string, and the web copilot used to
    read every 403 as "AI is turned off in Privacy settings" -- including an
    unverified address and a refused domain. The code says which it is.
    """

    def __init__(self, detail: str, code: str):
        super().__init__(detail)
        self.detail = detail
        self.code = code


class FirebaseTokenVerifier:
    def __init__(self, settings: Settings, policy: SignupPolicy | None = None):
        self.settings = settings
        self.policy = policy or get_signup_policy()
        try:
            firebase_admin.get_app()
        except ValueError:
            firebase_admin.initialize_app(
                credentials.ApplicationDefault(), {"projectId": settings.firebase_project_id}
            )

    def verify(self, token: str) -> AuthenticatedUser:
        try:
            decoded = auth.verify_id_token(token, check_revoked=True)
        except (
            auth.InvalidIdTokenError, auth.ExpiredIdTokenError, auth.RevokedIdTokenError,
            auth.UserDisabledError, ValueError,
        ) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired Firebase ID token",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        except Exception as exc:
            # check_revoked looks the user up on every request, so a Firebase
            # outage or a lost connection lands here. That is not a bad token:
            # answering 401 makes both clients sign the student out, when all
            # they needed was to try again in a moment.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not verify the sign-in right now. Please try again.",
            ) from exc
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Token has no UID")
        email = decoded.get("email")
        # Checked on every request, not only at sign-up: the Firebase web API key
        # is public, so an account can be created without ever touching this
        # service. 403 rather than 401 — the token is valid, the account is not
        # eligible, and retrying with a fresh one will not help.
        if not self.policy.allows(email):
            raise Forbidden(self.policy.describe(), "not_eligible")
        # The policy is about who owns the address, and Firebase issues a full
        # token the moment a password is chosen, before the verification mail
        # is opened. Without this anyone could register any @nwmissouri.edu
        # address and be let in. Only enforced while the policy itself is,
        # so a project with no domain restriction keeps working as before.
        if (
            self.settings.require_verified_email and self.policy.enforce
            and email and not decoded.get("email_verified")
        ):
            raise Forbidden(
                "Verify your email address to use the planner. Check your inbox "
                "for the link, then sign in again.",
                "email_unverified",
            )
        return AuthenticatedUser(uid=uid, email=email)


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

