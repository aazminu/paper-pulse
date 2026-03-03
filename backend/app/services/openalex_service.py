"""
OpenAlex API integration.

OpenAlex is a fully open catalog of the global research system - 250M+
scholarly works, 100k+ concepts, all freely available with no API key
required. It is the successor to Microsoft Academic Graph.

Docs: https://docs.openalex.org/
Rate limit: 100k requests/day (polite pool - just set a mailto in the header).
"""

import os
import logging
import time
import requests
from datetime import datetime, date, timedelta
from typing import List, Optional
from urllib.parse import quote

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("openalex")

OPENALEX_BASE_URL = "https://api.openalex.org"
OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "")
OPENALEX_RATE_LIMIT = 0.2 # seconds between requests 

DOMAIN_TO_CONCEPT = {
    "cs": "C41008148",       # Computer Science
    "math": "C33923547",     # Mathematics
    "physics": "C121332964", # Physics
    "q-bio": "C86803240",   # Biology
    "q-fin": "C162324750",  # Economics
    "stat": "C105795698",   # Statistics
    "eess": "C127413603",   # Engineering
    "econ": "C162324750",   # Economics
    "med": "C71924100",     # Medicine
    "bio": "C86803240",     # Biology
    "chem": "C185592680",   # Chemistry
    "env": "C39432304",     # Environmental Science
    "mat-sci": "C192562407",# Materials Science
    "psych": "C15744967",   # Psychology
    "geo": "C127313418",    # Geology
    "soc": "C144024400",    # Sociology
    "poli-sci": "C17744445",# Political Science
    "phil": "C138885662",   # Philosophy
    "hist": "C95457728",    # History
    "ling": "C41895202",    # Linguistics
    "art": "C142362112",    # Art
    "bus": "C144133560",    # Business
    "agri": "C118552586",   # Agricultural and Food Sciences
  "educ": "C185592680",  # Education 
  "law": "C138885662",  # Law 
    "astro-ph": "C121332964",
    "cond-mat": "C121332964",
    "gr-qc": "C121332964",
    "hep-ex": "C121332964",
    "hep-lat": "C121332964",
    "hep-ph": "C121332964",
    "hep-th": "C121332964",
    "math-ph": "C121332964",
    "nlin": "C121332964",
    "nucl-ex": "C121332964",
    "nucl-th": "C121332964",
    "quant-ph": "C121332964",
}


def _build_params(mailto: str = "") -> dict:
    """Build base query params with optional polite-pool mailto."""
    params = {}
    email = mailto or OPENALEX_MAILTO
    if email:
        params["mailto"] = email
    return params


def _parse_work(raw: dict) -> Optional[dict]:
    """Convert an OpenAlex work dict into our internal paper schema."""
    try:
        work_id = raw.get("id", "")
        title = (raw.get("title") or "").strip()

        abstract_inverted = raw.get("abstract_inverted_index")
        if abstract_inverted:
            position_word = []
            for word, positions in abstract_inverted.items():
                for pos in positions:
                    position_word.append((pos, word))
            position_word.sort()
            abstract = " ".join(w for _, w in position_word)
        else:
            abstract = ""

        if not title or not abstract or len(abstract) < 50:
            return None

        authorships = raw.get("authorships", [])
        authors = []
        for a in authorships:
            author_obj = a.get("author", {})
            name = author_obj.get("display_name", "")
            if name:
                authors.append(name)

        pub_date_str = raw.get("publication_date", "")
        if pub_date_str:
            try:
                published_date = datetime.strptime(pub_date_str, "%Y-%m-%d").date()
            except ValueError:
                published_date = date.today()
        else:
            published_date = date.today()

        ids = raw.get("ids", {})
        doi = ids.get("doi", "") or raw.get("doi", "")
        arxiv_id = ""
        locations = raw.get("locations", [])
        for loc in locations:
            source_url = loc.get("landing_page_url", "") or ""
            if "arxiv.org" in source_url:
                parts = source_url.split("/abs/")
                if len(parts) > 1:
                    arxiv_id = parts[1].split("v")[0]
                    break

        if arxiv_id:
            canonical_id = arxiv_id
            url = f"https://arxiv.org/abs/{arxiv_id}"
        elif doi:
            canonical_id = f"DOI:{doi.replace('https://doi.org/', '')}"
            url = doi if doi.startswith("http") else f"https://doi.org/{doi}"
        else:
            canonical_id = f"OA:{work_id.split('/')[-1]}"
            url = work_id

        return {
            "arxiv_id": canonical_id,
            "title": title,
            "authors": authors[:10],
            "published_date": published_date,
            "abstract": abstract,
            "url": url,
            "source": "openalex",
        }
    except Exception as e:
        logger.warning("Skipping malformed OpenAlex work: %s", e)
        return None


def fetch_recent_papers(
    domains: List[str],
    max_results: int = 30,
    days_back: int = 3,
    search_queries: List[str] | None = None,
) -> List[dict]:
    """
    Fetches recent scholarly works from OpenAlex.
    
    When search_queries are provided (LLM-optimized), runs each query with
    concept filter. OpenAlex auto-sorts by relevance_score when search= is
    used, so we only need the top results per query.
    
    Without search_queries, falls back to concept + recency sorting.
    """
    if not domains:
        return []

    concept_ids = set()
    for d in domains:
        cid = DOMAIN_TO_CONCEPT.get(d)
        if cid:
            concept_ids.add(cid)

    if not concept_ids:
        return []

    papers: List[dict] = []
    seen_ids: set = set()

    from_date = (date.today() - timedelta(days=days_back)).isoformat()

    if search_queries:
        per_query = max(10, max_results // len(search_queries))
        for query_text in search_queries:
            if len(papers) >= max_results:
                break
            for concept_id in concept_ids:
                if len(papers) >= max_results:
                    break

                params = _build_params()
                params.update({
                    "filter": f"concepts.id:{concept_id},from_publication_date:{from_date},has_abstract:true",
                    "search": query_text,
                    "per_page": min(50, per_query),
                    "page": 1,
                })

                try:
                    resp = requests.get(
                        f"{OPENALEX_BASE_URL}/works",
                        params=params,
                        timeout=30,
                    )

                    if resp.status_code == 429:
                        logger.warning("[OpenAlex] Rate limited, backing off...")
                        time.sleep(5)
                        continue

                    if resp.status_code != 200:
                        logger.warning("[OpenAlex] HTTP %d", resp.status_code)
                        continue

                    data = resp.json()
                    results = data.get("results", [])

                    for raw in results:
                        parsed = _parse_work(raw)
                        if parsed and parsed["arxiv_id"] not in seen_ids:
                            seen_ids.add(parsed["arxiv_id"])
                            papers.append(parsed)

                    time.sleep(OPENALEX_RATE_LIMIT)

                except Exception as e:
                    logger.error("[OpenAlex] Error: %s", e)
                    continue

        papers = papers[:max_results]
        logger.info("[OpenAlex] Fetched %d papers via %d optimized queries", len(papers), len(search_queries))
        return papers

    for concept_id in concept_ids:
        page = 1
        per_concept_limit = max(50, max_results // len(concept_ids))
        fetched = 0

        while fetched < per_concept_limit:
            per_page = min(50, per_concept_limit - fetched)

            params = _build_params()
            params.update({
                "filter": f"concepts.id:{concept_id},from_publication_date:{from_date},has_abstract:true",
                "sort": "publication_date:desc",
                "per_page": per_page,
                "page": page,
            })

            try:
                resp = requests.get(
                    f"{OPENALEX_BASE_URL}/works",
                    params=params,
                    timeout=30,
                )

                if resp.status_code == 429:
                    logger.warning("[OpenAlex] Rate limited, backing off...")
                    time.sleep(5)
                    continue

                if resp.status_code != 200:
                    logger.warning("[OpenAlex] HTTP %d", resp.status_code)
                    break

                data = resp.json()
                results = data.get("results", [])
                if not results:
                    break

                for raw in results:
                    parsed = _parse_work(raw)
                    if parsed and parsed["arxiv_id"] not in seen_ids:
                        seen_ids.add(parsed["arxiv_id"])
                        papers.append(parsed)

                fetched += len(results)
                page += 1
                time.sleep(OPENALEX_RATE_LIMIT)

            except Exception as e:
                logger.error("[OpenAlex] Error: %s", e)
                break

        if len(papers) >= max_results:
            break

    papers = papers[:max_results]
    logger.info("[OpenAlex] Fetched %d papers across %d concepts", len(papers), len(concept_ids))
    return papers
