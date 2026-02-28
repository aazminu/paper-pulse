"""
Cohere Rerank v4.0-pro integration.

Cohere's rerank-v4.0-pro is the state-of-the-art neural reranker with a massive
32K token context per document (8x larger than v3.5's 4K). Given a query
and a set of documents, it produces calibrated relevance scores using a
cross-encoder architecture — far more accurate than cosine similarity alone.

This module is used in two places:
  1. Feed pipeline — rerank top vector-similarity candidates for each user
  2. Q&A pipeline — rerank retrieved papers before passing to the LLM

Requires COHERE_API_KEY in your .env file.
Pricing: https://cohere.com/pricing
"""

import os
from typing import List, Optional

import cohere
from dotenv import load_dotenv

load_dotenv()

COHERE_API_KEY = os.getenv("COHERE_API_KEY", "")

if not COHERE_API_KEY:
    print("WARNING: COHERE_API_KEY not set. Reranking will fall back to embedding similarity order.")
    _client = None
else:
    _client = cohere.ClientV2(api_key=COHERE_API_KEY)

RERANK_MODEL = "rerank-v4.0-pro"


def rerank_papers(
    query: str,
    papers: List[dict],
    top_n: int = 25,
) -> List[dict]:
    """
    Rerank a list of papers against a query using Cohere rerank-v4.0-pro.

    Args:
        query:   The user's interest text or question.
        papers:  List of paper dicts (must have 'title' and 'abstract').
        top_n:   Number of top results to return.

    Returns:
        List of paper dicts reordered by Cohere relevance, with '_rerank_score'
        injected into each dict. Falls back to input order if Cohere is unavailable.
    """
    if not papers:
        return []

    if not _client:
        print("  [Rerank] No Cohere API key — returning papers in original order.")
        return papers[:top_n]

    # Build documents for Cohere — combine title + abstract (+ full_text if available)
    # rerank-v4.0-pro has 32K token context per doc, so no need to truncate
    documents = []
    for p in papers:
        title = p.get("title", "")
        full_text = p.get("full_text", "")
        abstract = p.get("abstract", "")
        body = full_text if full_text else abstract
        documents.append(f"{title}. {body}")

    try:
        response = _client.rerank(
            model=RERANK_MODEL,
            query=query,
            documents=documents,
            top_n=min(top_n, len(papers)),
        )

        reranked = []
        for result in response.results:
            paper = papers[result.index].copy()
            paper["_rerank_score"] = result.relevance_score
            reranked.append(paper)

        return reranked

    except Exception as e:
        print(f"  [Rerank] Cohere reranking failed, falling back to original order: {e}")
        return papers[:top_n]


def rerank_for_qa(
    question: str,
    papers: List[dict],
    top_n: int = 15,
) -> List[dict]:
    """
    Specialized reranking for the Q&A pipeline.
    Uses the user's question as the query for maximum relevance.
    """
    return rerank_papers(query=question, papers=papers, top_n=top_n)
