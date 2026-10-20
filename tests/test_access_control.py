from __future__ import annotations

import unittest

from services.access_control import valid_bearer_token


class AccessControlTests(unittest.TestCase):
    def test_accepts_matching_bearer_token(self) -> None:
        self.assertTrue(valid_bearer_token("example-secret", "Bearer example-secret"))

    def test_rejects_missing_or_invalid_credentials(self) -> None:
        for authorization in ("", "Basic example-secret", "Bearer wrong-secret", "Bearer"):
            with self.subTest(authorization=authorization):
                self.assertFalse(valid_bearer_token("example-secret", authorization))


if __name__ == "__main__":
    unittest.main()
