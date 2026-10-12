"""Tell iOS widgets that their data changed (WidgetKit push, iOS 26+).

After a record write commits, every widget push token registered for that
account gets `{"aps": {"content-changed": true}}`. iOS then reloads those
widgets' timelines, and the extension fetches the change itself through this
API. The push carries no planner content.

Off unless an APNs auth key is configured: without one this is a no-op, and
widgets fall back to their own refresh schedule plus the app's.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Callable, Dict, Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

logger = logging.getLogger(__name__)

HOSTS = {"production": "https://api.push.apple.com", "development": "https://api.sandbox.push.apple.com"}
# Widget pushes come out of the same daily budget as timeline reloads. A
# burst of writes (a recurring series, an import) needs one push, not twenty;
# the extension's fetch picks up everything since its last look anyway.
MIN_INTERVAL_SECONDS = 10.0


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


@dataclass
class WidgetPusher:
    key_pem: bytes = b""
    key_id: str = ""
    team_id: str = ""
    # Container app's bundle id + ".push-type.widgets".
    topic: str = ""
    timeout: float = 2.5
    client_factory: Callable[[], httpx.Client] = field(
        default=lambda: httpx.Client(http2=True, timeout=2.5)
    )
    clock: Callable[[], float] = time.time
    _token: Optional[tuple] = None
    _last: Dict[str, float] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    @property
    def enabled(self) -> bool:
        return bool(self.key_pem and self.key_id and self.team_id and self.topic)

    def _jwt(self) -> str:
        now = self.clock()
        # Apple refuses tokens older than an hour and throttles fresh ones
        # made more often than every 20 minutes.
        if self._token and now - self._token[1] < 40 * 60:
            return self._token[0]
        key = serialization.load_pem_private_key(self.key_pem, password=None)
        assert isinstance(key, ec.EllipticCurvePrivateKey)
        header = _b64(json.dumps({"alg": "ES256", "kid": self.key_id}).encode())
        claims = _b64(json.dumps({"iss": self.team_id, "iat": int(now)}).encode())
        r, s = decode_dss_signature(key.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
        token = f"{header}.{claims}.{_b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
        self._token = (token, now)
        return token

    def notify(self, uid: str, repository) -> int:
        """Push to every widget token of `uid`. Returns pushes accepted."""
        if not self.enabled:
            return 0
        with self._lock:
            now = self.clock()
            if now - self._last.get(uid, 0.0) < MIN_INTERVAL_SECONDS:
                return 0
            self._last[uid] = now
        tokens = repository.list_widget_push_tokens(uid)
        if not tokens:
            return 0
        sent = 0
        headers = {
            "authorization": f"bearer {self._jwt()}", "apns-push-type": "widgets",
            "apns-topic": self.topic, "apns-priority": "5", "apns-expiration": "0",
        }
        body = json.dumps({"aps": {"content-changed": True}})
        try:
            with self.client_factory() as client:
                for token, environment in tokens:
                    # The environment the device reported first; a build signed
                    # for the other one answers BadDeviceToken, so try it once.
                    order = [environment, "development" if environment == "production" else "production"]
                    for index, env in enumerate(order):
                        response = client.post(f"{HOSTS[env]}/3/device/{token}", headers=headers, content=body)
                        if response.status_code == 200:
                            sent += 1
                            if index:
                                repository.save_widget_push_token(uid, token, env)
                            break
                        reason = _reason(response)
                        if response.status_code == 410 or reason == "Unregistered":
                            repository.delete_widget_push_token(uid, token)
                            break
                        if reason == "BadDeviceToken" and index == 0:
                            continue
                        if reason == "BadDeviceToken":
                            repository.delete_widget_push_token(uid, token)
                        logger.info("widget push refused: %s %s", response.status_code, reason)
                        break
        except httpx.HTTPError:
            # Advisory: the write already committed and widgets still refresh
            # on their own schedule.
            logger.info("widget push unavailable", exc_info=True)
        return sent


def _reason(response: httpx.Response) -> str:
    try:
        return str(response.json().get("reason", ""))
    except ValueError:
        return ""
