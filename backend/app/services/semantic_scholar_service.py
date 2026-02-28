"""
Semantic Scholar API integration.

Semantic Scholar (by Allen AI) indexes 200M+ papers across all scientific
disciplines. Their API is free (rate-limited to 100 requests / 5 minutes
without a key, 1,000/min with a free key). Set SEMANTIC_SCHOLAR_API_KEY
in your .env to unlock higher throughput.

Docs: https://api.semanticscholar.org/
"""

import os
import time
import requests
from datetime import datetime, date, timedelta
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

S2_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
S2_BASE_URL = "https://api.semanticscholar.org/graph/v1"
S2_FIELDS = "paperId,title,abstract,authors,year,url,publicationDate,citationCount,fieldsOfStudy,externalIds"
S2_RATE_LIMIT = 1.0  # seconds between requests (unauthenticated: 1000 rps shared pool)

# ---------------------------------------------------------------------------
# Domain → Semantic Scholar "fieldsOfStudy" mapping
# ---------------------------------------------------------------------------
DOMAIN_TO_FIELDS = {
    "cs": "Computer Science",
    "math": "Mathematics",
    "physics": "Physics",
    "q-bio": "Biology",
    "q-fin": "Economics",
    "stat": "Mathematics",
    "eess": "Engineering",
    "econ": "Economics",
    "astro-ph": "Physics",
    "cond-mat": "Physics",
    "gr-qc": "Physics",
    "hep-ex": "Physics",
    "hep-lat": "Physics",
    "hep-ph": "Physics",
    "hep-th": "Physics",
    "math-ph": "Physics",
    "nlin": "Physics",
    "nucl-ex": "Physics",
    "nucl-th": "Physics",
    "quant-ph": "Physics",
    "med": "Medicine",
    "bio": "Biology",
    "chem": "Chemistry",
    "env": "Environmental Science",
    "mat-sci": "Materials Science",
    "psych": "Psychology",
    "geo": "Geology",
    "soc": "Sociology",
    "poli-sci": "Political Science",
    "phil": "Philosophy",
    "hist": "History",
    "ling": "Linguistics",
    "art": "Art",
    "bus": "Business",
    "agri": "Agricultural and Food Sciences",
    "educ": "Education",
    "law": "Law",
}


def _build_headers() -> dict:
    headers = {"Accept": "application/json"}
    if S2_API_KEY:
        headers["x-api-key"] = S2_API_KEY
    return headers


def _parse_paper(raw: dict) -> Optional[dict]:
    """Convert a Semantic Scholar paper dict into our internal schema."""
    try:
        paper_id = raw.get("paperId", "")
        title = (raw.get("title") or "").strip()
        abstract = (raw.get("abstract") or "").strip()

        if not title or not abstract:
            return None  # Skip papers without usable content

        authors = [a.get("name", "") for a in (raw.get("authors") or []) if a.get("name")]

        # Parse publication date
        pub_date_str = raw.get("publicationDate")
        if pub_date_str:
            try:
                published_date = datetime.strptime(pub_date_str, "%Y-%m-%d").date()
            except ValueError:
                published_date = date.today()
        else:
            year = raw.get("year")
            published_date = date(year, 1, 1) if year else date.today()

        # Build URL — prefer ArXiv link if available, else Semantic Scholar
        external_ids = raw.get("externalIds") or {}
        arxiv_id = external_ids.get("ArXiv", "")
        if arxiv_id:
            url = f"https://arxiv.org/abs/{arxiv_id}"
        else:
            url = raw.get("url") or f"https://www.semanticscholar.org/paper/{paper_id}"

        # Use ArXiv ID if available, otherwise S2 paper ID (prefixed)
        canonical_id = arxiv_id if arxiv_id else f"S2:{paper_id}"

        return {
            "arxiv_id": canonical_id,
            "title": title,
            "authors": authors,
            "published_date": published_date,
            "abstract": abstract,
            "url": url,
            "source": "semantic_scholar",
        }
    except Exception as e:
        print(f"  Skipping malformed S2 paper: {e}")
        return None


def fetch_recent_papers(
    domains: List[str],
    max_results: int = 30,
    days_back: int = 3,
    search_queries: List[str] | None = None,
) -> List[dict]:
    """
    Fetches recent papers from Semantic Scholar.
    
    When search_queries are provided (LLM-optimized), runs each query with
    fieldsOfStudy filter. S2 returns results sorted by relevance, so we
    only need top results per query.
    
    Without search_queries, falls back to field-of-study name as query.
    """
    if not domains:
        return []

    # Map our domain IDs to S2 fields-of-study keywords
    s2_fields = set()
    for d in domains:
        mapped = DOMAIN_TO_FIELDS.get(d)
        if mapped:
            s2_fields.add(mapped)

    if not s2_fields:
        return []

    headers = _build_headers()
    papers: List[dict] = []
    seen_ids: set = set()

    # Calculate date range
    end_date = date.today()
    start_date = end_date - timedelta(days=days_back)
    year_filter = f"{start_date.year}-{end_date.year}"

    # Build the list of (query_text, field_of_study) pairs to search
    query_pairs: list[tuple[str, str]] = []
    if search_queries:
        # Optimized: run each LLM query across each relevant field
        # but limit total combinations
        for query in search_queries:
            for field in s2_fields:
                query_pairs.append((query, field))
    else:
        # Fallback: use field name as query
        for field in s2_fields:
            query_pairs.append((field, field))

    per_pair_limit = max(10, max_results // max(len(query_pairs), 1))

    for query_text, field_of_study in query_pairs:
        if len(papers) >= max_results:
            break

        batch_limit = min(100, per_pair_limit)

        params = {
            "query": query_text,
            "fields": S2_FIELDS,
            "limit": batch_limit,
            "offset": 0,
            "year": year_filter,
            "fieldsOfStudy": field_of_study,
        }

        try:
            resp = requests.get(
                f"{S2_BASE_URL}/paper/search",
                params=params,
                headers=headers,
                timeout=30,
            )

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 10))
                retries = getattr(fetch_recent_papers, '_retries', 0) + 1
                if retries > 3:
                    print(f"  [S2] Rate limited too many times, skipping remaining requests")
                    fetch_recent_papers._retries = 0
                    break
                fetch_recent_papers._retries = retries
                print(f"  [S2] Rate limited, waiting {retry_after}s (attempt {retries}/3)…")
                time.sleep(retry_after)
                continue

            fetch_recent_papers._retries = 0  # Reset on success

            if resp.status_code != 200:
                print(f"  [S2] HTTP {resp.status_code} for query '{query_text}', skipping")
                continue

            data = resp.json()
            raw_papers = data.get("data", [])

            for raw in raw_papers:
                parsed = _parse_paper(raw)
                if parsed and parsed["arxiv_id"] not in seen_ids:
                    seen_ids.add(parsed["arxiv_id"])
                    papers.append(parsed)

            time.sleep(S2_RATE_LIMIT)

        except Exception as e:
            print(f"  [S2] Error fetching query '{query_text}': {e}")
            continue

    papers = papers[:max_results]
    print(f"[Semantic Scholar] Fetched {len(papers)} papers across {list(s2_fields)}")
    return papers
