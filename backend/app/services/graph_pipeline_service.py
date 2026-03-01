"""
Graph Population Pipeline for PaperPulse

Runs after the main daily pipeline to populate the Neo4j knowledge graph:
  1. Upsert all new papers as nodes
  2. Create author → paper relationships
  3. Extract concepts via LLM and link to papers
  4. Fetch citation data from Semantic Scholar
  5. Optionally fetch institution affiliations from OpenAlex

Designed to be idempotent — safe to re-run on existing data.
"""

import json
import urllib.request
import time
import os
from dotenv import load_dotenv

from app.database import supabase
from app.services.neo4j_service import (
    init_schema,
    upsert_papers_batch,
    upsert_authors_for_paper,
    upsert_concepts_for_paper,
    upsert_institutions_batch,
    add_citations,
    get_graph_stats,
)
from app.services.entity_extraction_service import batch_extract_entities
from app.services.citation_service import batch_fetch_citations

load_dotenv()

OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO", "")

# Max papers to process per run (to control API costs)
MAX_PAPERS_PER_RUN = 50
# Max papers to fetch citations for per run (S2 rate limits)
MAX_CITATION_FETCHES = 30


def fetch_openalex_affiliations(papers: list[dict]) -> list[dict]:
    """
    Fetch author-institution affiliations from OpenAlex for papers with DOIs.
    Returns: [{"author": "Name", "institution": "Inst"}]
    """
    affiliations = []
    mailto = f"&mailto={OPENALEX_MAILTO}" if OPENALEX_MAILTO else ""

    for paper in papers:
        doi = paper.get("doi")
        if not doi:
            continue

        url = f"https://api.openalex.org/works/doi:{doi}?select=authorships{mailto}"
        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", f"PaperPulse/1.0 (mailto:{OPENALEX_MAILTO})")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())

            for authorship in data.get("authorships", []):
                if not authorship:
                    continue
                author_info = authorship.get("author") or {}
                author_name = author_info.get("display_name")
                institutions = authorship.get("institutions") or []
                if author_name and institutions:
                    for inst in institutions:
                        if not inst:
                            continue
                        inst_name = inst.get("display_name")
                        if inst_name:
                            affiliations.append({
                                "author": author_name,
                                "institution": inst_name,
                            })

            time.sleep(0.3)  # Rate limit
        except Exception as e:
            print(f"    [OpenAlex] Affiliation fetch error for DOI {doi}: {e}")
            continue

    return affiliations


def run_graph_pipeline(paper_ids: list[str] | None = None):
    """
    Populate the Neo4j knowledge graph.

    Args:
        paper_ids: Specific paper IDs to process. If None, processes
                   papers that haven't been graphed yet (tracked via
                   'graph_processed' flag in Supabase).
    """
    print("\n" + "=" * 60)
    print("Starting Knowledge Graph Pipeline")
    print("=" * 60)

    # Step 0: Ensure Neo4j schema exists
    init_schema()

    # ------------------------------------------------------------------
    # Step 1: Get papers to process
    # ------------------------------------------------------------------
    if paper_ids:
        # Process specific papers
        query = supabase.table("papers").select("*").in_("arxiv_id", paper_ids)
    else:
        # Process papers not yet in graph
        # We'll use a simple heuristic: get recent papers ordered by created_at
        query = (
            supabase.table("papers")
            .select("*")
            .order("created_at", desc=True)
            .limit(MAX_PAPERS_PER_RUN)
        )

    response = query.execute()
    papers = response.data
    if not papers:
        print("No papers to process for graph pipeline.")
        return {"status": "success", "papers_processed": 0}

    print(f"Processing {len(papers)} papers for knowledge graph")

    # ------------------------------------------------------------------
    # Step 2: Upsert paper nodes
    # ------------------------------------------------------------------
    print("\n--- Step 1: Upserting paper nodes ---")
    upsert_papers_batch(papers)
    print(f"  Upserted {len(papers)} paper nodes")

    # ------------------------------------------------------------------
    # Step 3: Create author relationships
    # ------------------------------------------------------------------
    print("\n--- Step 2: Creating author relationships ---")
    for paper in papers:
        authors = paper.get("authors", [])
        if authors:
            upsert_authors_for_paper(paper["arxiv_id"], authors)
    print(f"  Processed authors for {len(papers)} papers")

    # ------------------------------------------------------------------
    # Step 4: LLM entity extraction (concepts)
    # ------------------------------------------------------------------
    print("\n--- Step 3: Extracting concepts via LLM ---")
    entities_map = batch_extract_entities(papers)

    concept_count = 0
    affiliation_count = 0
    all_affiliations = []

    for pid, entities in entities_map.items():
        concepts = entities.get("concepts", [])
        affiliations = entities.get("affiliations", [])

        if concepts:
            upsert_concepts_for_paper(pid, concepts)
            concept_count += len(concepts)

        if affiliations:
            all_affiliations.extend(affiliations)
            affiliation_count += len(affiliations)

    print(f"  Extracted {concept_count} concepts across {len(entities_map)} papers")

    # ------------------------------------------------------------------
    # Step 5: Fetch citations from Semantic Scholar
    # ------------------------------------------------------------------
    print("\n--- Step 4: Fetching citation data ---")
    citation_papers = papers[:MAX_CITATION_FETCHES]
    citation_map = batch_fetch_citations(citation_papers)

    citation_edges = 0
    for pid, cdata in citation_map.items():
        refs = cdata.get("references", [])
        cites = cdata.get("citations", [])

        if refs:
            add_citations(pid, refs)
            citation_edges += len(refs)

        # Reverse: papers that cite this one
        if cites:
            for citing_id in cites:
                add_citations(citing_id, [pid])
            citation_edges += len(cites)

    print(f"  Created {citation_edges} citation edges")

    # ------------------------------------------------------------------
    # Step 6: Fetch institution affiliations from OpenAlex
    # ------------------------------------------------------------------
    print("\n--- Step 5: Fetching institution affiliations ---")
    papers_with_dois = [p for p in papers if p.get("doi")]
    if papers_with_dois:
        openalex_affiliations = fetch_openalex_affiliations(papers_with_dois[:20])
        all_affiliations.extend(openalex_affiliations)

    if all_affiliations:
        upsert_institutions_batch(all_affiliations)

    print(f"  Stored {len(all_affiliations)} author-institution affiliations")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    stats = get_graph_stats()
    print(f"\n{'=' * 60}")
    print("Knowledge Graph Pipeline Complete!")
    print(f"  Papers processed this run: {len(papers)}")
    print(f"  Concepts extracted: {concept_count}")
    print(f"  Citation edges: {citation_edges}")
    print(f"  Affiliations: {len(all_affiliations)}")
    print(f"\n  Graph totals:")
    print(f"    Papers:      {stats.get('papers', 0)}")
    print(f"    Authors:     {stats.get('authors', 0)}")
    print(f"    Concepts:    {stats.get('concepts', 0)}")
    print(f"    Institutions:{stats.get('institutions', 0)}")
    print(f"    Citations:   {stats.get('citations', 0)}")
    print(f"    Authorships: {stats.get('authorships', 0)}")
    print(f"{'=' * 60}")

    return {
        "status": "success",
        "papers_processed": len(papers),
        "concepts_extracted": concept_count,
        "citation_edges": citation_edges,
        "affiliations": len(all_affiliations),
        "graph_stats": stats,
    }
