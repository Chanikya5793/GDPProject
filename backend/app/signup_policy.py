"""Who is allowed to use the planner.

The rules live in signup_policy.json next to this module so they can be changed
by editing one file and redeploying, without touching code. Precedence, from
strongest to weakest:

    blocked_emails  an explicit block, and nothing overrides it
    allowed_emails  an explicit exception to the domain rule
    allowed_domains the general rule
    enforce         false turns the whole thing off

Enforcement belongs on the server because that is the only side a caller cannot
skip: the Firebase web API key is public, so anyone can create an account by
calling Firebase directly. Blocking the token here means such an account cannot
read or write a single planner record.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

POLICY_FILENAME = "signup_policy.json"


@dataclass(frozen=True)
class SignupPolicy:
    enforce: bool = True
    allowed_domains: List[str] = field(default_factory=list)
    allowed_emails: List[str] = field(default_factory=list)
    blocked_emails: List[str] = field(default_factory=list)

    @staticmethod
    def from_mapping(raw: dict) -> "SignupPolicy":
        def lower_list(key: str) -> List[str]:
            return [str(item).strip().lower() for item in raw.get(key, []) if str(item).strip()]

        return SignupPolicy(
            enforce=bool(raw.get("enforce", True)),
            allowed_domains=lower_list("allowed_domains"),
            allowed_emails=lower_list("allowed_emails"),
            blocked_emails=lower_list("blocked_emails"),
        )

    def allows(self, email: Optional[str]) -> bool:
        if not self.enforce:
            return True
        address = (email or "").strip().lower()
        if not address or "@" not in address:
            # No verifiable address means the domain rule cannot be applied, and
            # silently admitting the caller would defeat the whole policy.
            return False
        if address in self.blocked_emails:
            return False
        if address in self.allowed_emails:
            return True
        if not self.allowed_domains:
            # Enforcing with no domains listed would lock everyone out, which is
            # far more likely a misedit than an intent to admit nobody.
            return True
        domain = address.rsplit("@", 1)[1]
        return domain in self.allowed_domains

    def describe(self) -> str:
        """A message safe to show a rejected user."""
        if not self.enforce or not self.allowed_domains:
            return "This planner is not restricted by email domain."
        domains = ", ".join(f"@{domain}" for domain in sorted(self.allowed_domains))
        return f"This planner is limited to {domains} accounts."


def load_policy(path: Optional[Path] = None) -> SignupPolicy:
    if path is None:
        # Path("") is Path("."), which is truthy and a directory, so an unset
        # override has to be checked as a string before it becomes a Path.
        override = os.getenv("PLANNER_SIGNUP_POLICY_PATH", "").strip()
        path = Path(override) if override else Path(__file__).with_name(POLICY_FILENAME)
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        # An absent file means "no policy configured", not "admit nobody".
        return SignupPolicy(enforce=False)
    return SignupPolicy.from_mapping(raw)


@lru_cache
def get_signup_policy() -> SignupPolicy:
    return load_policy()
