import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List

# ArXiv API uses specific namespaces for their XML tags
OAI_NS = {'atom': 'http://www.w3.org/2005/Atom'}

def fetch_daily_papers(domains: List[str], max_results: int = 50) -> List[dict]:
    """
    Fetches the most recent papers from ArXiv based on given domains.
    Example domains: ['cs', 'math', 'physics', 'q-bio', 'q-fin']
    """
    if not domains:
        return []

    # Map simple domain names to ArXiv category queries (e.g., cs -> cat:cs.*)
    category_queries = [f"cat:{domain}.*" for domain in domains]
    search_query = "+OR+".join(category_queries)

    # Build the URL: sort by submitted date, descending
    url = (
        f"http://export.arxiv.org/api/query?"
        f"search_query={search_query}&"
        f"sortBy=submittedDate&"
        f"sortOrder=descending&"
        f"start=0&"
        f"max_results={max_results}"
    )

    papers = []
    try:
        # Fetch the XML data
        with urllib.request.urlopen(url) as response:
            xml_data = response.read()

        # Parse the XML
        root = ET.fromstring(xml_data)

        for entry in root.findall('atom:entry', OAI_NS):
            # Extract basic paper info
            arxiv_id = entry.find('atom:id', OAI_NS).text.split('/abs/')[-1].split('v')[0]
            title = entry.find('atom:title', OAI_NS).text.replace('\n', ' ').strip()
            abstract = entry.find('atom:summary', OAI_NS).text.replace('\n', ' ').strip()
            url_link = entry.find('atom:id', OAI_NS).text
            
            # Parse authors
            authors = []
            for author in entry.findall('atom:author', OAI_NS):
                name = author.find('atom:name', OAI_NS).text
                authors.append(name)

            # Parse published date (ArXiv format: YYYY-MM-DDTHH:MM:SSZ)
            published_str = entry.find('atom:published', OAI_NS).text
            published_date = datetime.strptime(published_str, "%Y-%m-%dT%H:%M:%SZ").date()

            # Build the dictionary matching our PaperCreate schema
            papers.append({
                "arxiv_id": arxiv_id,
                "title": title,
                "authors": authors,
                "published_date": published_date,
                "abstract": abstract,
                "url": url_link
            })

        return papers

    except Exception as e:
        print(f"Error fetching from ArXiv: {e}")
        return []