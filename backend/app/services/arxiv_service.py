import logging
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List
import time

logger = logging.getLogger("arxiv")

OAI_NS = {'atom': 'http://www.w3.org/2005/Atom'}

ARXIV_BATCH_SIZE = 100
ARXIV_RATE_LIMIT_SECONDS = 3


def fetch_daily_papers(
    domains: List[str],
    max_results: int = 30,
    search_queries: List[str] | None = None,
    arxiv_categories: List[str] | None = None,
) -> List[dict]:
    """
    Fetches papers from ArXiv.

    When search_queries are provided (from the LLM optimizer), uses them as
    keyword search terms combined with category filters. ArXiv sorts by
    relevance when keywords are present, so we only need the top results.

    When no search_queries are given, falls back to broad category search
    sorted by submission date.
    """
    if not domains:
        return []

    if arxiv_categories:
        category_queries = [f"cat:{cat}" for cat in arxiv_categories]
    else:
        category_queries = []
        for domain in domains:
            if domain in ("cs", "math", "physics", "q-bio", "q-fin", "stat", "eess", "econ", "nlin"):
                category_queries.append(f"cat:{domain}.*")
            else:
                category_queries.append(f"cat:{domain}")

    cat_part = "+OR+".join(category_queries)

    if search_queries:
        return _fetch_with_queries(cat_part, search_queries, max_results)

    return _fetch_by_category(cat_part, max_results)


def _fetch_with_queries(
    cat_part: str,
    search_queries: List[str],
    max_results: int,
) -> List[dict]:
    """Run each optimized search query against ArXiv, merge results."""
    papers = []
    seen_ids: set = set()
    per_query = max(10, max_results // len(search_queries))

    for query_text in search_queries:
        encoded_q = urllib.parse.quote(query_text)
        search_query = f"({cat_part})+AND+all:{encoded_q}"

        url = (
            f"http://export.arxiv.org/api/query?"
            f"search_query={search_query}&"
            f"sortBy=relevance&"
            f"sortOrder=descending&"
            f"start=0&"
            f"max_results={per_query}"
        )

        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    xml_data = response.read()

                root = ET.fromstring(xml_data)
                entries = root.findall('atom:entry', OAI_NS)

                for entry in entries:
                    parsed = _parse_entry(entry)
                    if parsed and parsed["arxiv_id"] not in seen_ids:
                        seen_ids.add(parsed["arxiv_id"])
                        papers.append(parsed)
                break

            except Exception as e:
                if attempt < 2:
                    logger.warning("[ArXiv] Retry %d for query: %s", attempt+1, e)
                    time.sleep(3 * (attempt + 1))
                else:
                    logger.error("[ArXiv] Failed after 3 attempts for query: %s", e)

        time.sleep(ARXIV_RATE_LIMIT_SECONDS)

    logger.info("[ArXiv] Fetched %d papers via %d optimized queries", len(papers), len(search_queries))
    return papers[:max_results]


def _fetch_by_category(cat_part: str, max_results: int) -> List[dict]:
    """Fallback: fetch by broad category sorted by date."""
    papers = []
    start = 0

    while start < max_results:
        batch_size = min(ARXIV_BATCH_SIZE, max_results - start)
        url = (
            f"http://export.arxiv.org/api/query?"
            f"search_query={cat_part}&"
            f"sortBy=submittedDate&"
            f"sortOrder=descending&"
            f"start={start}&"
            f"max_results={batch_size}"
        )

        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                xml_data = response.read()

            root = ET.fromstring(xml_data)
            entries = root.findall('atom:entry', OAI_NS)

            if not entries:
                break

            for entry in entries:
                parsed = _parse_entry(entry)
                if parsed:
                    papers.append(parsed)

            start += batch_size

            if start < max_results:
                time.sleep(ARXIV_RATE_LIMIT_SECONDS)

        except Exception as e:
            logger.error("Error fetching ArXiv batch at start=%d: %s", start, e)
            break

    logger.info("[ArXiv] Fetched %d papers by category", len(papers))
    return papers


def _parse_entry(entry) -> dict | None:
    """Parse a single ArXiv Atom entry into our paper dict."""
    try:
        arxiv_id = entry.find('atom:id', OAI_NS).text.split('/abs/')[-1].split('v')[0]
        title = entry.find('atom:title', OAI_NS).text.replace('\n', ' ').strip()
        abstract = entry.find('atom:summary', OAI_NS).text.replace('\n', ' ').strip()
        url_link = entry.find('atom:id', OAI_NS).text

        authors = []
        for author in entry.findall('atom:author', OAI_NS):
            name = author.find('atom:name', OAI_NS)
            if name is not None:
                authors.append(name.text)

        published_str = entry.find('atom:published', OAI_NS).text
        published_date = datetime.strptime(published_str, "%Y-%m-%dT%H:%M:%SZ").date()

        return {
            "arxiv_id": arxiv_id,
            "title": title,
            "authors": authors,
            "published_date": published_date,
            "abstract": abstract,
            "url": url_link,
            "source": "arxiv",
        }
    except Exception as parse_err:
        logger.warning("Skipping malformed ArXiv entry: %s", parse_err)
        return None