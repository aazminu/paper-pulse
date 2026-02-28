"""
Multimodal File Processor — Extract content from various file types.

Supports:
  - Images (PNG, JPG, GIF, WEBP) → passed directly to gpt-4.1 vision
  - PDFs → text extraction via PyMuPDF
  - Word documents (.docx) → text extraction via python-docx
  - Audio (MP3, WAV, M4A, WEBM, OGG) → transcription via Whisper
  - Video (MP4, MOV, AVI, MKV) → audio track extraction + Whisper
  - Plain text / code files → read directly
"""

import io
import os
import base64
import tempfile
import subprocess
from typing import Optional

import fitz  # PyMuPDF
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ---------------------------------------------------------------------------
# Supported MIME types
# ---------------------------------------------------------------------------
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
PDF_TYPES = {"application/pdf"}
WORD_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
AUDIO_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
    "audio/m4a", "audio/mp4", "audio/webm", "audio/ogg",
}
VIDEO_TYPES = {
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/webm",
}
TEXT_TYPES = {
    "text/plain", "text/csv", "text/markdown",
    "application/json", "application/xml",
}

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def get_file_category(content_type: str) -> str:
    """Classify a MIME type into a processing category."""
    if content_type in IMAGE_TYPES:
        return "image"
    if content_type in PDF_TYPES:
        return "pdf"
    if content_type in WORD_TYPES:
        return "word"
    if content_type in AUDIO_TYPES:
        return "audio"
    if content_type in VIDEO_TYPES:
        return "video"
    if content_type in TEXT_TYPES:
        return "text"
    return "unsupported"


def process_image(file_bytes: bytes, content_type: str) -> dict:
    """
    Encode image as base64 data URL for gpt-4.1 vision.
    Returns a dict with type="image" and the data URL.
    """
    b64 = base64.b64encode(file_bytes).decode("utf-8")
    data_url = f"data:{content_type};base64,{b64}"
    return {"type": "image", "data_url": data_url}


def process_pdf(file_bytes: bytes) -> dict:
    """Extract text from a PDF using PyMuPDF."""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages = []
    for page in doc:
        text = page.get_text("text")
        if text and text.strip():
            pages.append(text.strip())
    doc.close()

    full_text = "\n\n".join(pages)
    # Strip null bytes
    full_text = full_text.replace("\u0000", "")
    return {"type": "text", "content": full_text, "label": "PDF Document"}


def process_word(file_bytes: bytes) -> dict:
    """Extract text from a .docx file using python-docx."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    full_text = "\n\n".join(paragraphs)
    return {"type": "text", "content": full_text, "label": "Word Document"}


def process_audio(file_bytes: bytes, filename: str) -> dict:
    """Transcribe audio using Whisper."""
    ext = os.path.splitext(filename)[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text",
            )
        return {"type": "text", "content": transcript, "label": "Audio Transcription"}
    finally:
        os.unlink(tmp_path)


def process_video(file_bytes: bytes, filename: str) -> dict:
    """
    Extract audio track from video using ffmpeg, then transcribe with Whisper.
    Falls back to a message if ffmpeg is not available.
    """
    ext = os.path.splitext(filename)[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_video:
        tmp_video.write(file_bytes)
        video_path = tmp_video.name

    audio_path = video_path + ".mp3"

    try:
        # Extract audio track with ffmpeg
        result = subprocess.run(
            ["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame",
             "-q:a", "4", "-y", audio_path],
            capture_output=True, timeout=120,
        )
        if result.returncode != 0:
            return {
                "type": "text",
                "content": "[Could not extract audio from video]",
                "label": "Video",
            }

        with open(audio_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text",
            )
        return {"type": "text", "content": transcript, "label": "Video Transcription"}
    finally:
        for p in (video_path, audio_path):
            if os.path.exists(p):
                os.unlink(p)


def process_text_file(file_bytes: bytes) -> dict:
    """Read a plain text / code / CSV file."""
    try:
        content = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = file_bytes.decode("latin-1")
    return {"type": "text", "content": content, "label": "Text File"}


def process_file(
    file_bytes: bytes,
    content_type: str,
    filename: str,
) -> Optional[dict]:
    """
    Route a file to the appropriate processor.

    Returns:
        dict with:
          - type: "image" | "text"
          - For images: data_url (base64 data URL)
          - For text: content (extracted text), label (human-readable type)
        Or None if unsupported.
    """
    category = get_file_category(content_type)

    if category == "image":
        return process_image(file_bytes, content_type)
    elif category == "pdf":
        return process_pdf(file_bytes)
    elif category == "word":
        return process_word(file_bytes)
    elif category == "audio":
        return process_audio(file_bytes, filename)
    elif category == "video":
        return process_video(file_bytes, filename)
    elif category == "text":
        return process_text_file(file_bytes)
    else:
        return None
