from __future__ import annotations

import io
import json
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from services.knowledge_brain import ai_provider
from services.knowledge_brain.main import app


class TranscriptionTests(unittest.TestCase):
    def test_transcribe_requires_provider_credentials(self) -> None:
        with patch.dict(os.environ, {"TRANSCRIPTION_API_KEY": ""}):
            with TestClient(app) as client:
                response = client.post(
                    "/transcribe",
                    files={"audio": ("meeting.wav", b"audio data", "audio/wav")},
                )
        self.assertEqual(response.status_code, 503)
        self.assertIn("TRANSCRIPTION_API_KEY", response.json()["detail"])

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


if __name__ == "__main__":
    unittest.main()
