"""
ArXiv Full-Text PDF Extraction Service.

With gpt-4.1's 1M token context window, we no longer need to rely on just
paper abstracts.  This service downloads ArXiv PDFs and extracts the full
text so the LLM can cross-reference entire papers natively.

Uses PyMuPDF (fitz) — the fastest pure-Python PDF text extractor.

Usage:
  from app.services.pdf_service import extract_arxiv_full_text
  full_text = extract_arxiv_full_text("2401.12345")
"""

import io
import os
import re
import tempfile
import time
import urllib.request
from typing import Optional

import fitz  # type: ignore[import-untyped]  # PyMuPDF


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ARXIV_PDF_BASE = "https://arxiv.org/pdf/{arxiv_id}.pdf"
PDF_DOWNLOAD_TIMEOUT = 30  # seconds
PDF_RATE_LIMIT_SECONDS = 1  # Be polite to ArXiv servers
MAX_TEXT_CHARS = 120_000  # ~30K tokens — keeps embedding + LLM calls reasonable
USER_AGENT = "PaperPulse/1.0 (Academic Research Tool; mailto:paperpulse@example.com)"


def extract_arxiv_full_text(arxiv_id: str) -> Optional[str]:
    """
    Download an ArXiv paper PDF and extract its full text.

    Args:
        arxiv_id: The ArXiv paper ID, e.g. "2401.12345"

    Returns:
        Cleaned full text string, or None if extraction fails.
    """
    url = ARXIV_PDF_BASE.format(arxiv_id=arxiv_id)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=PDF_DOWNLOAD_TIMEOUT) as response:
            pdf_bytes = response.read()
    except Exception as e:
        print(f"  [PDF] Failed to download {arxiv_id}: {e}")
        return None

    try:
        text = _extract_text_from_bytes(pdf_bytes)
        if text and len(text.strip()) > 200:
            cleaned = _clean_extracted_text(text)
            return cleaned[:MAX_TEXT_CHARS] if cleaned else None
        return None
    except Exception as e:
        print(f"  [PDF] Failed to extract text from {arxiv_id}: {e}")
        return None


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> Optional[str]:
    """
    Extract text from raw PDF bytes (for non-ArXiv sources).
    """
    try:
        text = _extract_text_from_bytes(pdf_bytes)
        if text and len(text.strip()) > 200:
            cleaned = _clean_extracted_text(text)
            return cleaned[:MAX_TEXT_CHARS] if cleaned else None
        return None
    except Exception as e:
        print(f"  [PDF] Extraction error: {e}")
        return None


def _extract_text_from_bytes(pdf_bytes: bytes) -> str:
    """Use PyMuPDF to extract text from PDF bytes in memory."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages_text = []

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        if text:
            pages_text.append(text)

    doc.close()
    return "\n\n".join(pages_text)


def _clean_extracted_text(text: str) -> str:
    """
    Clean up PDF-extracted text:
    - Remove excessive whitespace / line breaks
    - Remove page headers/footers (common patterns)
    - Remove reference numbering artifacts
    - Normalize unicode
    """
    # Collapse multiple newlines into double newline (paragraph break)
    text = text.replace('\u0000', '')  # Strip null bytes (Postgres can't store them)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)

    # Remove common PDF artifacts
    # Page numbers at start/end of lines
    text = re.sub(r'^\d+\s*$', '', text, flags=re.MULTILINE)

    # Remove hyphenation at line breaks (e.g., "computa-\ntion" → "computation")
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)

    # Clean up remaining single newlines within paragraphs
    # (keep double newlines as paragraph breaks)
    text = re.sub(r'(?<!\n)\n(?!\n)', ' ', text)

    # Collapse resultant multiple spaces again
    text = re.sub(r' {2,}', ' ', text)

    return text.strip()


def batch_extract_arxiv(
    arxiv_ids: list[str],
    rate_limit: float = PDF_RATE_LIMIT_SECONDS,
) -> dict[str, Optional[str]]:
    """
    Extract full text from multiple ArXiv papers with rate limiting.

    Args:
        arxiv_ids: List of ArXiv paper IDs.
        rate_limit: Seconds to wait between downloads.

    Returns:
        Dict mapping arxiv_id → full_text (or None on failure).
    """
    results: dict[str, Optional[str]] = {}

    for i, arxiv_id in enumerate(arxiv_ids):
        print(f"  [PDF] Extracting {arxiv_id} ({i + 1}/{len(arxiv_ids)})...")
        results[arxiv_id] = extract_arxiv_full_text(arxiv_id)

        if i < len(arxiv_ids) - 1:
            time.sleep(rate_limit)

    succeeded = sum(1 for v in results.values() if v is not None)
    print(f"  [PDF] Extracted {succeeded}/{len(arxiv_ids)} papers successfully")
    return results
