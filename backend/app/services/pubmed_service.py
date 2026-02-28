"""
PubMed / NCBI E-utilities API integration.

PubMed indexes 35M+ biomedical and life-science citations from MEDLINE,
life science journals, and online books. The E-utilities API is free and
requires no API key for up to 3 requests/second (10/s with an API key).

Set NCBI_API_KEY in your .env for higher throughput.

Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
"""

import os
import time
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, date, timedelta
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

NCBI_API_KEY = os.getenv("NCBI_API_KEY", "")
NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
NCBI_RATE_LIMIT = 0.35 if NCBI_API_KEY else 1.0  # seconds between requests

# ---------------------------------------------------------------------------
# Domain → PubMed MeSH term mapping
# Only domains with meaningful biomedical/life-science overlap are mapped.
# Others simply return no results from PubMed (which is fine — we have 3
# other sources to cover them).
# ---------------------------------------------------------------------------
DOMAIN_TO_MESH = {
    "q-bio": ["Computational Biology", "Quantitative Biology"],
    "bio": ["Biology"],
    "med": ["Medicine", "Clinical Medicine"],
    "chem": ["Chemistry", "Biochemistry"],
    "psych": ["Psychology", "Neurosciences"],
    "agri": ["Agriculture", "Food Science"],
    "env": ["Environmental Health", "Ecology"],
    "physics": ["Biophysics"],
    "cs": ["Medical Informatics", "Artificial Intelligence"],
    "stat": ["Biostatistics", "Statistics as Topic"],
    "mat-sci": ["Biocompatible Materials"],
}


def _build_params() -> dict:
    """Build base query params with optional API key."""
    params = {}
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY
    return params


def _search_pmids(query: str, max_results: int = 100, days_back: int = 7, sort: str = "date") -> List[str]:
    """
    Use esearch to find PMIDs matching a query string.
    sort can be "date" (default) or "relevance" (when using optimized queries).
    Returns a list of PubMed ID strings.
    """
    params = _build_params()
    params.update({
        "db": "pubmed",
        "term": query,
        "retmax": max_results,
        "sort": sort,
        "datetype": "edat",
        "reldate": days_back,
        "retmode": "json",
    })

    try:
        resp = requests.get(f"{NCBI_BASE}/esearch.fcgi", params=params, timeout=30)
        if resp.status_code != 200:
            print(f"  [PubMed] esearch HTTP {resp.status_code}")
            return []
        data = resp.json()
        return data.get("esearchresult", {}).get("idlist", [])
    except Exception as e:
        print(f"  [PubMed] esearch error: {e}")
        return []


def _fetch_details(pmids: List[str]) -> List[dict]:
    """
    Use efetch to get full details for a list of PMIDs.
    Returns a list of parsed paper dicts.
    """
    if not pmids:
        return []

    papers: List[dict] = []

    # Process in batches of 50 (efetch recommended max)
    for batch_start in range(0, len(pmids), 50):
        batch = pmids[batch_start:batch_start + 50]
        params = _build_params()
        params.update({
            "db": "pubmed",
            "id": ",".join(batch),
            "retmode": "xml",
        })

        try:
            resp = requests.get(f"{NCBI_BASE}/efetch.fcgi", params=params, timeout=30)
            if resp.status_code != 200:
                print(f"  [PubMed] efetch HTTP {resp.status_code}")
                continue

            root = ET.fromstring(resp.text)

            for article_el in root.findall(".//PubmedArticle"):
                parsed = _parse_article(article_el)
                if parsed:
                    papers.append(parsed)

            time.sleep(NCBI_RATE_LIMIT)
        except Exception as e:
            print(f"  [PubMed] efetch error: {e}")
            continue

    return papers


def _parse_article(article_el) -> Optional[dict]:
    """Parse a PubmedArticle XML element into our internal paper schema."""
    try:
        medline = article_el.find(".//MedlineCitation")
        if medline is None:
            return None

        pmid_el = medline.find("PMID")
        pmid = pmid_el.text if pmid_el is not None else ""
        if not pmid:
            return None

        article = medline.find("Article")
        if article is None:
            return None

        # Title
        title_el = article.find("ArticleTitle")
        title = (title_el.text or "").strip() if title_el is not None else ""

        # Abstract
        abstract_el = article.find(".//Abstract")
        if abstract_el is not None:
            abstract_parts = []
            for text_el in abstract_el.findall("AbstractText"):
                label = text_el.get("Label", "")
                text_content = "".join(text_el.itertext()).strip()
                if label:
                    abstract_parts.append(f"{label}: {text_content}")
                else:
                    abstract_parts.append(text_content)
            abstract = " ".join(abstract_parts)
        else:
            abstract = ""

        if not title or not abstract or len(abstract) < 50:
            return None

        # Authors
        authors = []
        author_list = article.find("AuthorList")
        if author_list is not None:
            for author_el in author_list.findall("Author"):
                last = author_el.find("LastName")
                fore = author_el.find("ForeName")
                name_parts = []
                if fore is not None and fore.text:
                    name_parts.append(fore.text)
                if last is not None and last.text:
                    name_parts.append(last.text)
                if name_parts:
                    authors.append(" ".join(name_parts))

        # Publication date
        pub_date_el = article.find(".//PubDate")
        published_date = date.today()
        if pub_date_el is not None:
            year_el = pub_date_el.find("Year")
            month_el = pub_date_el.find("Month")
            day_el = pub_date_el.find("Day")
            try:
                year = int(year_el.text) if year_el is not None and year_el.text else date.today().year
                month_str = month_el.text if month_el is not None and month_el.text else "1"
                # PubMed months can be abbreviations like "Jan", "Feb"
                try:
                    month = int(month_str)
                except ValueError:
                    month_map = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                                 "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
                    month = month_map.get(month_str.lower()[:3], 1)
                day = int(day_el.text) if day_el is not None and day_el.text else 1
                published_date = date(year, month, day)
            except (ValueError, TypeError):
                pass

        # DOI
        doi = ""
        article_ids = article_el.findall(".//ArticleId")
        for aid in article_ids:
            if aid.get("IdType") == "doi" and aid.text:
                doi = aid.text
                break

        # Canonical ID and URL
        canonical_id = f"PMID:{pmid}"
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

        return {
            "arxiv_id": canonical_id,
            "title": title,
            "authors": authors[:10],
            "published_date": published_date,
            "abstract": abstract,
            "url": url,
            "source": "pubmed",
            "doi": doi,
        }
    except Exception as e:
        print(f"  [PubMed] Error parsing article: {e}")
        return None


def fetch_recent_papers(
    domains: List[str],
    max_results: int = 30,
    days_back: int = 7,
    search_queries: List[str] | None = None,
) -> List[dict]:
    """
    Fetches recent papers from PubMed.
    
    When search_queries are provided (LLM-optimized), combines each query
    with MeSH terms and sorts by relevance. PubMed supports sort=relevance
    so we only need top results.
    
    Without search_queries, falls back to MeSH-only sorted by date.
    """
    if not domains:
        return []

    # Collect MeSH terms for the given domains
    mesh_terms: List[str] = []
    for d in domains:
        terms = DOMAIN_TO_MESH.get(d, [])
        mesh_terms.extend(terms)

    if not mesh_terms:
        print(f"[PubMed] No MeSH mappings for domains {domains}, skipping.")
        return []

    # Deduplicate
    mesh_terms = list(set(mesh_terms))

    papers: List[dict] = []
    seen_ids: set = set()
    per_term_limit = max(20, max_results // len(mesh_terms))

    for term in mesh_terms:
        # Build PubMed query: MeSH term, optionally refined by LLM-optimized queries
        if search_queries:
            # Run each optimized query combined with this MeSH term
            for sq in search_queries:
                if len(papers) >= max_results:
                    break
                query = f'({sq}) AND ("{term}"[MeSH Terms])'
                print(f"  [PubMed] Searching: {query} (limit={per_term_limit})")
                pmids = _search_pmids(query, max_results=per_term_limit, days_back=days_back, sort="relevance")
                if pmids:
                    time.sleep(NCBI_RATE_LIMIT)
                    details = _fetch_details(pmids)
                    for p in details:
                        if p["arxiv_id"] not in seen_ids:
                            seen_ids.add(p["arxiv_id"])
                            papers.append(p)
        else:
            query = f'"{term}"[MeSH Terms]'
            print(f"  [PubMed] Searching: {query} (limit={per_term_limit})")
            pmids = _search_pmids(query, max_results=per_term_limit, days_back=days_back)
            if pmids:
                time.sleep(NCBI_RATE_LIMIT)
                details = _fetch_details(pmids)
                for p in details:
                    if p["arxiv_id"] not in seen_ids:
                        seen_ids.add(p["arxiv_id"])
                        papers.append(p)

        if len(papers) >= max_results:
            break

    papers = papers[:max_results]
    print(f"[PubMed] Fetched {len(papers)} papers across {len(mesh_terms)} MeSH terms")
    return papers
