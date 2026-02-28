"""
PaperPulse Daily Pipeline — LLM-Optimized Per-User Fetching

Flow:
  1. For each user → load their cached LLM-optimized search profile
  2. Query all 4 sources with optimized keywords + sub-categories (~30/source)
  3. Global dedup → embed + summarize all new unique papers (once)
  4. For each user → Cohere rerank-v4.0-pro on their pool → top 25

The LLM query optimizer (o4-mini) transforms casual user interests into
precision search queries at onboarding. The cached profile eliminates the
need for heavy post-retrieval ranking (RRF) — the APIs themselves return
relevance-sorted results matched to exact technical vocabulary.

Sources: ArXiv · Semantic Scholar · PubMed · OpenAlex
Embedding: text-embedding-3-large (1536-dim)
Re-ranking: Cohere rerank-v4.0-pro (32K context per doc)
Summaries: o4-mini (reasoning_effort=low)
Query Optimisation: o4-mini (reasoning_effort=low)
Q&A: gpt-4.1 — best instruction-following model with 1M context
PDF: Full-text extraction for ArXiv papers via PyMuPDF
"""

import json
from app.database import supabase
from app.services.arxiv_service import fetch_daily_papers as fetch_arxiv
from app.services.semantic_scholar_service import fetch_recent_papers as fetch_s2
from app.services.pubmed_service import fetch_recent_papers as fetch_pubmed
from app.services.openalex_service import fetch_recent_papers as fetch_openalex
from app.services.openai_service import (
    get_embeddings_batch,
    generate_paper_summary,
)
from app.services.rerank_service import rerank_papers
from app.services.pdf_service import batch_extract_arxiv
from app.services.query_optimizer import optimize_user_interests
from app.services.chunking_service import batch_chunk_papers

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PER_SOURCE_LIMIT = 30         # Papers per source per user (APIs sort by relevance)
EMBEDDING_BATCH_SIZE = 64     # Papers to embed in one API call
TOP_MATCHES_PER_USER = 25     # Feed items per user after re-ranking


def _deduplicate_papers(paper_lists: list[list[dict]]) -> list[dict]:
    """
    Merge papers from multiple sources, deduplicating by arxiv_id / title.
    Prefers ArXiv-sourced entries when duplicates exist.
    """
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    merged: list[dict] = []

    # ArXiv papers first (they have canonical IDs)
    for papers in paper_lists:
        for p in papers:
            pid = p.get("arxiv_id", "")
            title_key = p.get("title", "").lower().strip()[:100]

            if pid in seen_ids or title_key in seen_titles:
                continue

            seen_ids.add(pid)
            if title_key:
                seen_titles.add(title_key)
            merged.append(p)

    return merged


def run_daily_pipeline():
    """
    LLM-optimized per-user pipeline:
      1. Load users + their cached optimized search profiles
      2. For each user → fetch ~30/source with optimized queries
      3. Global dedup → ArXiv PDF extract → batch embed → summarize
      4. For each user → Cohere rerank → save top 25 to feed
    """
    print("=" * 60)
    print("Starting PaperPulse Daily Pipeline (LLM-Optimized Queries)")
    print("=" * 60)

    # ------------------------------------------------------------------
    # Step 1: Get all users
    # ------------------------------------------------------------------
    users_response = supabase.table("users").select("*").execute()
    users = users_response.data
    if not users:
        print("No users found. Exiting.")
        return {"status": "success", "message": "No users to process"}

    print(f"Processing {len(users)} user(s)")

    # ------------------------------------------------------------------
    # Step 2: Per-user fetching with LLM-optimized queries
    # ------------------------------------------------------------------
    user_paper_ids: dict[str, set[str]] = {}
    all_raw_papers: list[dict] = []
    source_counts = {"arxiv": 0, "semantic_scholar": 0, "pubmed": 0, "openalex": 0}

    for user in users:
        user_id = user["id"]
        domains = user.get("domains", [])
        interest_text = user.get("interest_text", "") or ""
        user_paper_ids[user_id] = set()

        if not domains:
            print(f"  User {user_id[:8]}… — no domains, skipping fetch")
            continue

        # Load cached optimized queries (generated at onboarding)
        optimized_raw = user.get("optimized_queries")
        if optimized_raw:
            try:
                optimized = json.loads(optimized_raw) if isinstance(optimized_raw, str) else optimized_raw
            except (json.JSONDecodeError, TypeError):
                optimized = None
        else:
            optimized = None

        # If no cached profile, generate one now and save it
        if not optimized or not optimized.get("search_queries"):
            print(f"  User {user_id[:8]}… — no cached queries, generating now…")
            optimized = optimize_user_interests(interest_text, domains)
            try:
                supabase.table("users").update({
                    "optimized_queries": json.dumps(optimized)
                }).eq("id", user_id).execute()
            except Exception as e:
                print(f"    Failed to cache optimized queries: {e}")

        search_queries = optimized.get("search_queries", [])
        keywords = optimized.get("keywords", [])
        arxiv_categories = optimized.get("arxiv_categories", [])

        print(f"\n  User {user_id[:8]}… — domains={domains}")
        print(f"    queries: {search_queries}")
        print(f"    keywords: {keywords}")

        # Use the optimized search query as the Cohere rerank query later
        rerank_query = " ".join(search_queries) if search_queries else interest_text

        # Fetch from each source with optimized queries
        try:
            arxiv = fetch_arxiv(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
                arxiv_categories=arxiv_categories or None,
            )
            source_counts["arxiv"] += len(arxiv)
        except Exception as e:
            print(f"    [ArXiv] Error: {e}")
            arxiv = []

        try:
            s2 = fetch_s2(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["semantic_scholar"] += len(s2)
        except Exception as e:
            print(f"    [S2] Error: {e}")
            s2 = []

        try:
            pubmed = fetch_pubmed(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["pubmed"] += len(pubmed)
        except Exception as e:
            print(f"    [PubMed] Error: {e}")
            pubmed = []

        try:
            openalex = fetch_openalex(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["openalex"] += len(openalex)
        except Exception as e:
            print(f"    [OpenAlex] Error: {e}")
            openalex = []

        user_papers = arxiv + s2 + pubmed + openalex
        print(f"    Fetched {len(user_papers)} papers "
              f"(ArXiv={len(arxiv)}, S2={len(s2)}, PubMed={len(pubmed)}, OpenAlex={len(openalex)})")

        for p in user_papers:
            user_paper_ids[user_id].add(p.get("arxiv_id", ""))

        all_raw_papers.extend(user_papers)

    # ------------------------------------------------------------------
    # Step 3: Global dedup across all users
    # ------------------------------------------------------------------
    all_papers = _deduplicate_papers([all_raw_papers])
    print(f"\nTotal unique papers across all users: {len(all_papers)}")

    # ------------------------------------------------------------------
    # Step 4: Process papers (Embed + Summarize) — only new ones
    # ------------------------------------------------------------------
    print("\n--- Processing papers (embed + summarize) ---")
    processed_papers: dict[str, dict] = {}
    papers_to_embed: list[tuple[str, dict]] = []

    for paper in all_papers:
        pid = paper["arxiv_id"]

        existing = (
            supabase.table("papers")
            .select("arxiv_id")
            .eq("arxiv_id", pid)
            .execute()
        )
        if existing.data:
            full_existing = (
                supabase.table("papers")
                .select("*")
                .eq("arxiv_id", pid)
                .execute()
            )
            processed_papers[pid] = full_existing.data[0]
            continue

        paper_record = {
            "arxiv_id": pid,
            "title": paper["title"],
            "authors": paper["authors"],
            "published_date": paper["published_date"].isoformat()
                if hasattr(paper["published_date"], "isoformat")
                else str(paper["published_date"]),
            "abstract": paper["abstract"],
            "url": paper["url"],
            "source": paper.get("source", "unknown"),
            "doi": paper.get("doi", None),
        }
        processed_papers[pid] = paper_record
        papers_to_embed.append((pid, paper_record))

    print(f"New papers to embed: {len(papers_to_embed)}")

    # Extract full text from ArXiv PDFs
    arxiv_papers_to_extract = [
        (pid, p) for pid, p in papers_to_embed
        if p.get("source") == "arxiv" and pid.strip()
    ]
    full_texts: dict[str, str | None] = {}
    if arxiv_papers_to_extract:
        print(f"\n--- Extracting full text from {len(arxiv_papers_to_extract)} ArXiv PDFs ---")
        ids_to_extract = [pid for pid, _ in arxiv_papers_to_extract]
        full_texts = batch_extract_arxiv(ids_to_extract, rate_limit=1.0)

    # Batch embed
    if papers_to_embed:
        for batch_start in range(0, len(papers_to_embed), EMBEDDING_BATCH_SIZE):
            batch = papers_to_embed[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
            texts = [f"{p['title']}. {p['abstract']}" for _, p in batch]

            print(f"  Embedding batch {batch_start // EMBEDDING_BATCH_SIZE + 1} "
                  f"({len(batch)} papers)...")
            vectors = get_embeddings_batch(texts)

            for (pid, paper_record), vector in zip(batch, vectors):
                paper_record["abstract_vector"] = vector

                ft = full_texts.get(pid)
                if ft:
                    paper_record["full_text"] = ft

                summary = generate_paper_summary(paper_record["abstract"])
                paper_record["summary"] = summary

                try:
                    supabase.table("papers").insert(paper_record).execute()
                except Exception as db_err:
                    print(f"  DB insert error for {pid}: {db_err}")

                processed_papers[pid] = paper_record

    # ------------------------------------------------------------------
    # Step 5: Chunk + embed full-text papers for sub-document Q&A
    # ------------------------------------------------------------------
    papers_with_text = [
        processed_papers[pid]
        for pid, _ in papers_to_embed
        if processed_papers.get(pid, {}).get("full_text")
    ]
    if papers_with_text:
        print(f"\n--- Chunking {len(papers_with_text)} full-text papers ---")
        all_chunks = batch_chunk_papers(papers_with_text)
        print(f"  Generated {len(all_chunks)} chunks total")

        # Batch embed all chunks
        if all_chunks:
            for batch_start in range(0, len(all_chunks), EMBEDDING_BATCH_SIZE):
                batch = all_chunks[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
                chunk_texts = [c["chunk_text"] for c in batch]

                print(f"  Embedding chunk batch {batch_start // EMBEDDING_BATCH_SIZE + 1} "
                      f"({len(batch)} chunks)...")
                chunk_vectors = get_embeddings_batch(chunk_texts)

                for chunk, vector in zip(batch, chunk_vectors):
                    chunk_record = {
                        "paper_id": chunk["paper_id"],
                        "chunk_index": chunk["chunk_index"],
                        "chunk_text": chunk["chunk_text"],
                        "chunk_vector": vector,
                    }
                    try:
                        supabase.table("paper_chunks").insert(chunk_record).execute()
                    except Exception as chunk_err:
                        print(f"    Chunk insert error: {chunk_err}")

            print(f"  Stored {len(all_chunks)} chunks in paper_chunks table")

    # ------------------------------------------------------------------
    # Step 6: Per-user Cohere rerank → top 25
    #   No RRF needed — APIs already returned relevance-sorted results
    #   via LLM-optimized queries. Cohere just picks the best 25.
    # ------------------------------------------------------------------
    print("\n--- Ranking papers per user (Cohere Rerank) ---")
    feed_items_created = 0

    for user in users:
        user_id = user["id"]
        interest_text = user.get("interest_text", "") or ""
        paper_ids_for_user = user_paper_ids.get(user_id, set())

        if not paper_ids_for_user:
            print(f"  Skipping user {user_id[:8]}… (no papers fetched)")
            continue

        # Build rerank query from optimized queries or fallback to interest_text
        optimized_raw = user.get("optimized_queries")
        if optimized_raw:
            try:
                optimized = json.loads(optimized_raw) if isinstance(optimized_raw, str) else optimized_raw
                rerank_query = " ".join(optimized.get("search_queries", []))
            except (json.JSONDecodeError, TypeError):
                rerank_query = interest_text
        else:
            rerank_query = interest_text

        if not rerank_query:
            rerank_query = interest_text or "recent research"

        # Build this user's paper pool
        user_pool = [
            processed_papers[pid]
            for pid in paper_ids_for_user
            if pid in processed_papers
        ]

        print(f"  User {user_id[:8]}… — {len(user_pool)} papers → Cohere rerank → top {TOP_MATCHES_PER_USER}")

        # Cohere rerank picks the best 25 from the pool
        if len(user_pool) > TOP_MATCHES_PER_USER:
            reranked = rerank_papers(
                query=rerank_query,
                papers=user_pool,
                top_n=TOP_MATCHES_PER_USER,
            )
        else:
            reranked = user_pool

        # Save to feed_items
        for rank, paper in enumerate(reranked):
            relevance_score = paper.get("_rerank_score",
                              1.0 - (rank / max(len(reranked), 1)))
            feed_record = {
                "user_id": user_id,
                "paper_id": paper["arxiv_id"],
                "relevance_score": relevance_score,
                "is_saved": False,
            }
            try:
                supabase.table("feed_items").insert(feed_record).execute()
                feed_items_created += 1
            except Exception:
                pass  # UNIQUE constraint — already in feed

    print(f"\n{'=' * 60}")
    print(f"Pipeline complete!")
    print(f"  Users processed: {len(users)}")
    print(f"  Unique papers: {len(processed_papers)}")
    print(f"  Feed items created: {feed_items_created}")
    print(f"{'=' * 60}")

    return {
        "status": "success",
        "users_processed": len(users),
        "papers_processed": len(processed_papers),
        "feed_items_created": feed_items_created,
        "sources": source_counts,
    }