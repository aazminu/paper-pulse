"""
Citation Fetcher for PaperPulse Knowledge Graph

Fetches citation relationships (references + citations) from:
  1. Semantic Scholar API  (primary — has ArXiv ID mapping)
  2. OpenAlex API          (fallback — uses DOI)

Returns lists of cited paper IDs to build the CITES relationship in Neo4j.
"""

import time
import urllib.request
import urllib.parse
import json
import os
from dotenv import load_dotenv

load_dotenv()

OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "")

# Semantic Scholar fields we need
S2_FIELDS = "externalIds,title"
S2_BASE = "https://api.semanticscholar.org/graph/v1/paper"


def _s2_get(url: str) -> dict | None:
    """Make a GET request to Semantic Scholar API with rate limiting."""
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "PaperPulse/1.0")
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"    [CitationFetch] S2 request failed: {e}")
        return None


def fetch_citations_s2(arxiv_id: str) -> dict:
    """
    Fetch references (papers this paper cites) and citations (papers that cite this)
    from Semantic Scholar.

    Returns: {
        "references": ["arxiv_id_1", ...],
        "citations": ["arxiv_id_2", ...]
    }
    """
    clean_id = arxiv_id.strip()
    if not clean_id:
        return {"references": [], "citations": []}

    result = {"references": [], "citations": []}

    # Fetch references (papers this paper cites)
    refs_url = f"{S2_BASE}/ARXIV:{clean_id}/references?fields={S2_FIELDS}&limit=100"
    refs_data = _s2_get(refs_url)
    time.sleep(1.0)  # Rate limit

    if refs_data and "data" in refs_data:
        for item in refs_data["data"]:
            if not item:
                continue
            cited = item.get("citedPaper") or {}
            ext_ids = cited.get("externalIds") or {}
            # Prefer ArXiv ID
            aid = ext_ids.get("ArXiv")
            if aid:
                result["references"].append(aid)

    # Fetch citations (papers that cite this paper)
    cites_url = f"{S2_BASE}/ARXIV:{clean_id}/citations?fields={S2_FIELDS}&limit=100"
    cites_data = _s2_get(cites_url)
    time.sleep(1.0)

    if cites_data and "data" in cites_data:
        for item in cites_data["data"]:
            if not item:
                continue
            citing = item.get("citingPaper") or {}
            ext_ids = citing.get("externalIds") or {}
            aid = ext_ids.get("ArXiv")
            if aid:
                result["citations"].append(aid)

    return result


def fetch_citations_openalex(doi: str) -> dict:
    """
    Fallback: Fetch citations from OpenAlex using DOI.
    Returns same format as fetch_citations_s2.
    """
    if not doi:
        return {"references": [], "citations": []}

    result = {"references": [], "citations": []}

    # Fetch the work
    mailto_param = f"&mailto={OPENALEX_MAILTO}" if OPENALEX_MAILTO else ""
    work_url = f"https://api.openalex.org/works/doi:{doi}?select=id,referenced_works,cited_by_api_url{mailto_param}"

    try:
        req = urllib.request.Request(work_url)
        req.add_header("User-Agent", f"PaperPulse/1.0 (mailto:{OPENALEX_MAILTO})")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        print(f"    [CitationFetch] OpenAlex request failed: {e}")
        return result

    # Get referenced works (papers this paper cites)
    referenced = data.get("referenced_works", [])
    for ref_url in referenced[:100]:
        # OpenAlex IDs look like https://openalex.org/W123456
        # We need to resolve them to get ArXiv IDs
        pass  # OpenAlex doesn't easily give ArXiv IDs, so S2 is primary

    time.sleep(0.5)
    return result


def batch_fetch_citations(papers: list[dict], rate_limit: float = 1.5) -> dict[str, dict]:
    """
    Fetch citations for a batch of papers.
    Returns: {arxiv_id: {"references": [...], "citations": [...]}}

    Uses Semantic Scholar as primary source (best ArXiv ID coverage).
    """
    results = {}

    for paper in papers:
        pid = paper.get("arxiv_id", "").strip()
        if not pid:
            continue

        print(f"  [CitationFetch] Fetching for {pid}: {paper.get('title', '')[:50]}…")
        citation_data = fetch_citations_s2(pid)

        ref_count = len(citation_data["references"])
        cite_count = len(citation_data["citations"])

        if ref_count or cite_count:
            print(f"    → {ref_count} references, {cite_count} citations")
        else:
            print(f"    → No citation data found")

        results[pid] = citation_data
        time.sleep(rate_limit)  # Be nice to the API

    return results
