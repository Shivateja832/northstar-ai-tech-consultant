from __future__ import annotations

import json
import os
import urllib.error
import uuid
import urllib.request
from typing import Any


class AIProviderError(RuntimeError):
    pass


def configured() -> bool:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return False
    base_url = (os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1") or "").rstrip("/")
    if not base_url:
        return False
    probe_urls: list[str] = []
    if base_url.endswith("/v1"):
        probe_urls.append(base_url.rsplit("/v1", 1)[0] + "/api/tags")
        probe_urls.append(f"{base_url}/models")
    else:
        probe_urls.append(f"{base_url}/models")
    for probe_url in probe_urls:
        try:
            request = urllib.request.Request(
                probe_url,
                headers={"Authorization": f"Bearer {api_key}"},
                method="GET",
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                if response.status in {200, 201, 204}:
                    return True
        except (urllib.error.URLError, TimeoutError, ValueError):
            continue
    return False


def transcription_configured() -> bool:
    return bool(os.getenv("TRANSCRIPTION_API_KEY"))


def transcribe_audio(filename: str, content_type: str, audio: bytes) -> str:
    api_key = os.getenv("TRANSCRIPTION_API_KEY")
    if not api_key:
        raise AIProviderError(
            "Audio transcription is not configured. Add a valid TRANSCRIPTION_API_KEY to the local .env."
        )
    base_url = os.getenv("TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    boundary = f"----Northstar{uuid.uuid4().hex}"
    fields = {
        "model": os.getenv("TRANSCRIPTION_MODEL", "whisper-1"),
        "response_format": "json",
    }
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )
    safe_filename = filename.replace('"', "").replace("\r", "").replace("\n", "")
    parts.extend(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            audio,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    request = urllib.request.Request(
        f"{base_url}/audio/transcriptions",
        data=b"".join(parts),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.loads(response.read().decode("utf-8"))
        transcript = result.get("text")
        if not isinstance(transcript, str) or not transcript.strip():
            raise AIProviderError("Transcription provider returned no transcript text.")
        return transcript.strip()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AIProviderError(
            f"Audio transcription provider returned HTTP {exc.code}: {detail}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise AIProviderError(f"Audio transcription request failed: {exc}") from exc


def generate_json(system_prompt: str, user_prompt: str, images: list[str] | None = None) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise AIProviderError("AI model is not configured. Set OPENAI_API_KEY and OPENAI_MODEL in the project .env file.")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    user_content: Any = user_prompt
    if images:
        user_content = [{"type": "text", "text": user_prompt}]
        user_content.extend(
            {"type": "image_url", "image_url": {"url": image_url, "detail": "low"}}
            for image_url in images[:8]
        )
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": int(os.getenv("AI_MAX_OUTPUT_TOKENS", "512")),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    }
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=float(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "180"))) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise AIProviderError("The configured AI provider returned JSON that was not an object.")
        return parsed
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
        raise AIProviderError(f"AI provider request failed: {exc}") from exc
