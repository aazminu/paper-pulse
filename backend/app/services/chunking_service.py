"""
Paper Chunking Service — Full-Text → Overlapping Chunks for Dense Retrieval

Splits PDF-extracted full text into ~512-token chunks with ~50-token overlap.
Chunks are embedded independently and stored in the `paper_chunks` table,
enabling sub-document vector search during Q&A ("parent-child retrieval").

Why chunking matters:
  - Abstract-only embeddings miss 95%+ of a paper's content
  - Full-text embeddings dilute signal across thousands of tokens
  - Chunk-level search pinpoints the exact paragraph that answers a question
  - Cohere reranking on chunks is far more precise than on whole papers

Token counting uses tiktoken's cl100k_base (same tokenizer as
text-embedding-3-large), so chunk sizes respect the model's native boundaries.
"""

import re
from typing import Optional

import tiktoken

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHUNK_SIZE_TOKENS = 512     # Target tokens per chunk
CHUNK_OVERLAP_TOKENS = 50   # Overlap between consecutive chunks
MIN_CHUNK_TOKENS = 50       # Skip chunks smaller than this

# cl100k_base is the tokenizer used by text-embedding-3-large
_enc = tiktoken.get_encoding("cl100k_base")


def _count_tokens(text: str) -> int:
    """Count tokens using the same tokenizer as the embedding model."""
    return len(_enc.encode(text))


def _split_into_paragraphs(text: str) -> list[str]:
    """
    Split text into paragraphs on double-newlines.
    Falls back to single-newline splits if paragraphs are too large.
    """
    # Primary split on double newlines (paragraph boundaries)
    paragraphs = re.split(r'\n\n+', text)

    # If any paragraph is still very large, split on single newlines
    result = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if _count_tokens(para) > CHUNK_SIZE_TOKENS * 2:
            # Sub-split on single newlines
            sub_parts = para.split('\n')
            for sp in sub_parts:
                sp = sp.strip()
                if sp:
                    result.append(sp)
        else:
            result.append(para)

    return result


def _merge_paragraphs_into_chunks(
    paragraphs: list[str],
    chunk_size: int = CHUNK_SIZE_TOKENS,
    overlap: int = CHUNK_OVERLAP_TOKENS,
) -> list[str]:
    """
    Greedily merge paragraphs into chunks of ~chunk_size tokens.
    Consecutive chunks share ~overlap tokens of trailing context.
    """
    if not paragraphs:
        return []

    chunks: list[str] = []
    current_parts: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = _count_tokens(para)

        # If a single paragraph exceeds chunk_size, force-split by sentences
        if para_tokens > chunk_size:
            # Flush current buffer first
            if current_parts:
                chunks.append("\n\n".join(current_parts))
                current_parts = []
                current_tokens = 0

            # Split oversized paragraph by sentences
            sentences = re.split(r'(?<=[.!?])\s+', para)
            for sent in sentences:
                sent_tokens = _count_tokens(sent)
                if current_tokens + sent_tokens > chunk_size and current_parts:
                    chunks.append(" ".join(current_parts))
                    # Keep overlap from end
                    overlap_parts = _get_overlap_parts(current_parts, overlap)
                    current_parts = overlap_parts
                    current_tokens = sum(_count_tokens(p) for p in current_parts)
                current_parts.append(sent)
                current_tokens += sent_tokens
            continue

        # Would adding this paragraph exceed the chunk size?
        if current_tokens + para_tokens > chunk_size and current_parts:
            # Flush current chunk
            chunks.append("\n\n".join(current_parts))

            # Build overlap from the tail of the current chunk
            overlap_parts = _get_overlap_parts(current_parts, overlap)
            current_parts = overlap_parts
            current_tokens = sum(_count_tokens(p) for p in current_parts)

        current_parts.append(para)
        current_tokens += para_tokens

    # Flush remaining
    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks


def _get_overlap_parts(parts: list[str], target_tokens: int) -> list[str]:
    """
    Return the last N parts from the list that total ~target_tokens.
    Used to create overlapping context between consecutive chunks.
    """
    if target_tokens <= 0:
        return []

    overlap: list[str] = []
    tokens_so_far = 0

    for part in reversed(parts):
        pt = _count_tokens(part)
        if tokens_so_far + pt > target_tokens and overlap:
            break
        overlap.insert(0, part)
        tokens_so_far += pt

    return overlap


def chunk_paper(
    full_text: str,
    paper_id: str,
    title: Optional[str] = None,
) -> list[dict]:
    """
    Split a paper's full text into overlapping chunks ready for embedding.

    Each chunk dict contains:
        paper_id:     str  — FK to papers table
        chunk_index:  int  — 0-based position in the paper
        chunk_text:   str  — the chunk content (prepended with title for context)

    Args:
        full_text:  The PDF-extracted full text of the paper.
        paper_id:   The paper's arxiv_id (or other unique ID).
        title:      Optional paper title to prepend for embedding context.

    Returns:
        List of chunk dicts, or empty list if text is too short.
    """
    if not full_text or _count_tokens(full_text) < MIN_CHUNK_TOKENS:
        return []

    paragraphs = _split_into_paragraphs(full_text)
    raw_chunks = _merge_paragraphs_into_chunks(paragraphs)

    # Filter out tiny chunks
    chunks = [c for c in raw_chunks if _count_tokens(c) >= MIN_CHUNK_TOKENS]

    if not chunks:
        return []

    # Prepend title to each chunk for embedding context
    # (helps the embedding model understand what paper this chunk belongs to)
    title_prefix = f"[{title}] " if title else ""

    result = []
    for idx, chunk_text in enumerate(chunks):
        result.append({
            "paper_id": paper_id,
            "chunk_index": idx,
            "chunk_text": f"{title_prefix}{chunk_text}",
        })

    return result


def batch_chunk_papers(
    papers: list[dict],
) -> list[dict]:
    """
    Chunk multiple papers at once.

    Args:
        papers: List of paper dicts, each must have:
            - arxiv_id: str
            - title: str
            - full_text: str (optional — papers without it are skipped)

    Returns:
        Flat list of all chunk dicts across all papers.
    """
    all_chunks: list[dict] = []

    for paper in papers:
        full_text = paper.get("full_text")
        if not full_text:
            continue

        paper_chunks = chunk_paper(
            full_text=full_text,
            paper_id=paper["arxiv_id"],
            title=paper.get("title"),
        )
        all_chunks.extend(paper_chunks)

    return all_chunks
