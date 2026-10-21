from __future__ import annotations

import io
import json
import os
import urllib.error
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from services.knowledge_brain import ai_provider
from services.knowledge_brain.main import app


class TranscriptionTests(unittest.TestCase):
    def test_transcribe_requires_provider_credentials(self) -> None:
        with patch.dict(os.environ, {"TRANSCRIPTION_API_KEY": "", "OPENAI_API_KEY": ""}):
            with TestClient(app) as client:
                response = client.post(
                    "/transcribe",
                    files={"audio": ("meeting.wav", b"audio data", "audio/wav")},
                )
        self.assertEqual(response.status_code, 503)
        self.assertIn("TRANSCRIPTION_API_KEY or OPENAI_API_KEY", response.json()["detail"])

    def test_transcribe_rejects_unsupported_recording_format(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/transcribe",
                files={"audio": ("meeting.txt", b"not audio", "text/plain")},
            )
        self.assertEqual(response.status_code, 415)

    def test_audio_provider_sends_multipart_and_parses_transcript(self) -> None:
        response = io.BytesIO(json.dumps({"text": "Consent-based interview transcript."}).encode())
        response.headers = {"Content-Type": "application/json"}
        with patch.dict(
            os.environ,
            {
                "TRANSCRIPTION_API_KEY": "local-test-key",
                "TRANSCRIPTION_BASE_URL": "https://transcription.example.test/v1",
                "TRANSCRIPTION_MODEL": "whisper-test",
            },
        ), patch.object(ai_provider.urllib.request, "urlopen", return_value=response) as urlopen:
            transcript = ai_provider.transcribe_audio(
                "interview.wav",
                "audio/wav",
                b"audio test payload",
            )
        self.assertEqual(transcript, "Consent-based interview transcript.")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://transcription.example.test/v1/audio/transcriptions")
        self.assertEqual(request.get_header("Authorization"), "Bearer local-test-key")
        self.assertIn(b"name=\"model\"\r\n\r\nwhisper-test", request.data)
        self.assertIn(b"audio test payload", request.data)

    def test_audio_provider_reuses_openai_key_when_transcription_key_is_unset(self) -> None:
        response = io.BytesIO(json.dumps({"text": "Transcribed with the shared API key."}).encode())
        response.headers = {"Content-Type": "application/json"}
        with patch.dict(
            os.environ,
            {
                "TRANSCRIPTION_API_KEY": "",
                "OPENAI_API_KEY": "shared-openai-key",
                "TRANSCRIPTION_BASE_URL": "https://api.openai.com/v1",
            },
        ), patch.object(ai_provider.urllib.request, "urlopen", return_value=response) as urlopen:
            self.assertTrue(ai_provider.transcription_configured())
            transcript = ai_provider.transcribe_audio("meeting.wav", "audio/wav", b"audio")
            authorization = urlopen.call_args.args[0].get_header("Authorization") or ""
            self.assertTrue(authorization.startswith("Bearer "))
            self.assertTrue(authorization.endswith("shared-openai-key"))

        self.assertEqual(transcript, "Transcribed with the shared API key.")

    def test_model_provider_reports_quota_429_actionably(self) -> None:
        error = urllib.error.HTTPError(
            "https://api.openai.com/v1/chat/completions",
            429,
            "Too Many Requests",
            {},
            io.BytesIO(b'{"error":{"code":"insufficient_quota","type":"insufficient_quota"}}'),
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            ai_provider.urllib.request, "urlopen", side_effect=error
        ):
            with self.assertRaisesRegex(ai_provider.AIProviderError, "quota or billing limit"):
                ai_provider.generate_json("system", "user")


if __name__ == "__main__":
    unittest.main()
