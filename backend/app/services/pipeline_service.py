"""
PaperPulse Daily Pipeline - LLM-Optimized Per-User Fetching

Flow:
  1. For each user -> load their cached LLM-optimized search profile
  2. Query all 4 sources with optimized keywords + sub-categories (~30/source)
  3. Global dedup -> embed + summarize all new unique papers (once)
  4. For each user -> Cohere rerank-v4.0-pro on their pool -> top 25

The LLM query optimizer (o4-mini) transforms casual user interests into
precision search queries at onboarding. The cached profile eliminates the
need for heavy post-retrieval ranking (RRF) - the APIs themselves return
relevance-sorted results matched to exact technical vocabulary.

Sources: ArXiv, Semantic Scholar, PubMed, OpenAlex
Embedding: text-embedding-3-large (1536-dim)
Re-ranking: Cohere rerank-v4.0-pro (32K context per doc)
Summaries: o4-mini (reasoning_effort=low)
Query Optimization: o4-mini (reasoning_effort=low)
Q&A: gpt-4.1 - best instruction-following model with 1M context
PDF: Full-text extraction for ArXiv papers via PyMuPDF
"""

import json
import logging
import time
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

logger = logging.getLogger("pipeline")

PER_SOURCE_LIMIT = 30         # Papers per source per user 
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


def run_single_user_pipeline(user_id: str):
    """
    Bootstrap pipeline for a single new user.
    Fetches papers, embeds, summarizes, reranks, and populates their feed.
    Called right after onboarding so the user sees content immediately.
    """
    logger.info("=" * 60)
    logger.info("Bootstrapping feed for user %s...", user_id[:8])
    logger.info("=" * 60)

    user_resp = supabase.table("users").select("*").eq("id", user_id).execute()
    if not user_resp.data:
        logger.warning("User %s not found, aborting.", user_id[:8])
        return

    user = user_resp.data[0]
    domains = user.get("domains", [])
    interest_text = user.get("interest_text", "") or ""

    if not domains:
        logger.warning("User %s has no domains selected, aborting.", user_id[:8])
        return

    optimized_raw = user.get("optimized_queries")
    if optimized_raw:
        try:
            optimized = json.loads(optimized_raw) if isinstance(optimized_raw, str) else optimized_raw
        except (json.JSONDecodeError, TypeError):
            optimized = None
    else:
        optimized = None

    if not optimized or not optimized.get("search_queries"):
        optimized = optimize_user_interests(interest_text, domains)
        try:
            supabase.table("users").update({
                "optimized_queries": json.dumps(optimized)
            }).eq("id", user_id).execute()
        except Exception as e:
            logger.error("Failed to cache optimized queries: %s", e)

    search_queries = optimized.get("search_queries", [])
    keywords = optimized.get("keywords", [])
    arxiv_categories = optimized.get("arxiv_categories", [])
    rerank_query = " ".join(search_queries) if search_queries else interest_text

    logger.info("  domains=%s, queries=%d, categories=%d",
                domains, len(search_queries), len(arxiv_categories))

    arxiv, s2, pubmed, openalex = [], [], [], []

    try:
        arxiv = fetch_arxiv(
            domains, max_results=PER_SOURCE_LIMIT,
            search_queries=search_queries or None,
            arxiv_categories=arxiv_categories or None,
        )
    except Exception as e:
        logger.error("[ArXiv] Fetch error: %s", e)

    try:
        s2 = fetch_s2(
            domains, max_results=PER_SOURCE_LIMIT,
            search_queries=search_queries or None,
        )
    except Exception as e:
        logger.error("[S2] Fetch error: %s", e)

    try:
        pubmed = fetch_pubmed(
            domains, max_results=PER_SOURCE_LIMIT,
            search_queries=search_queries or None,
        )
    except Exception as e:
        logger.error("[PubMed] Fetch error: %s", e)

    try:
        openalex = fetch_openalex(
            domains, max_results=PER_SOURCE_LIMIT,
            search_queries=search_queries or None,
        )
    except Exception as e:
        logger.error("[OpenAlex] Fetch error: %s", e)

    all_papers = _deduplicate_papers([arxiv, s2, pubmed, openalex])
    logger.info("Fetched %d unique papers (ArXiv=%d, S2=%d, PubMed=%d, OpenAlex=%d)",
                len(all_papers), len(arxiv), len(s2), len(pubmed), len(openalex))

    if not all_papers:
        logger.warning("No papers found for user %s, aborting.", user_id[:8])
        return

    processed_papers: dict[str, dict] = {}
    papers_to_embed: list[tuple[str, dict]] = []

    for paper in all_papers:
        pid = paper["arxiv_id"]
        existing = supabase.table("papers").select("arxiv_id").eq("arxiv_id", pid).execute()
        if existing.data:
            full = supabase.table("papers").select("*").eq("arxiv_id", pid).execute()
            processed_papers[pid] = full.data[0]
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

    logger.info("New papers to embed: %d (skipped %d existing)",
                len(papers_to_embed), len(all_papers) - len(papers_to_embed))

    arxiv_papers_to_extract = [
        (pid, rec) for pid, rec in papers_to_embed
        if rec.get("source") == "arxiv"
    ]
    full_texts: dict[str, str | None] = {}
    if arxiv_papers_to_extract:
        logger.info("Extracting full text from %d ArXiv PDFs...", len(arxiv_papers_to_extract))
        ids_to_extract = [pid for pid, _ in arxiv_papers_to_extract]
        full_texts = batch_extract_arxiv(ids_to_extract, rate_limit=1.0)

    if papers_to_embed:
        total_papers = len(papers_to_embed)
        for batch_start in range(0, total_papers, EMBEDDING_BATCH_SIZE):
            batch = papers_to_embed[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
            texts = [f"{p['title']}. {p['abstract']}" for _, p in batch]

            logger.info("Embedding batch %d (%d papers)...",
                        batch_start // EMBEDDING_BATCH_SIZE + 1, len(batch))
            embed_start = time.time()
            vectors = get_embeddings_batch(texts)
            logger.info("  Embedding completed in %.1fs", time.time() - embed_start)

            for idx, ((pid, paper_record), vector) in enumerate(zip(batch, vectors)):
                paper_record["abstract_vector"] = vector

                ft = full_texts.get(pid)
                if ft:
                    paper_record["full_text"] = ft

                paper_num = batch_start + idx + 1
                logger.info("  Summarizing paper %d/%d: %s",
                            paper_num, total_papers, paper_record["title"][:80])
                summ_start = time.time()
                summary = generate_paper_summary(paper_record["abstract"])
                paper_record["summary"] = summary
                logger.debug("    Summary generated in %.1fs", time.time() - summ_start)

                try:
                    supabase.table("papers").insert(paper_record).execute()
                except Exception as db_err:
                    logger.error("DB insert error for paper %s: %s", pid[:20], db_err)

                processed_papers[pid] = paper_record

    papers_with_text = [
        processed_papers[pid]
        for pid, _ in papers_to_embed
        if processed_papers.get(pid, {}).get("full_text")
    ]
    if papers_with_text:
        logger.info("Chunking %d full-text papers...", len(papers_with_text))
        all_chunks = batch_chunk_papers(papers_with_text)
        if all_chunks:
            logger.info("Generated %d chunks, embedding...", len(all_chunks))
            for batch_start in range(0, len(all_chunks), EMBEDDING_BATCH_SIZE):
                batch = all_chunks[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
                chunk_texts = [c["chunk_text"] for c in batch]
                logger.info("  Embedding chunk batch %d/%d (%d chunks)...",
                            batch_start // EMBEDDING_BATCH_SIZE + 1,
                            (len(all_chunks) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE,
                            len(batch))
                chunk_vectors = get_embeddings_batch(chunk_texts)

                for chunk, vector in zip(batch, chunk_vectors):
                    chunk_record = {
                        "paper_id": chunk["paper_id"],
                        "chunk_index": chunk["chunk_index"],
                        "chunk_text": chunk["chunk_text"],
                        "chunk_vector": vector,
                    }
                    for attempt in range(3):
                        try:
                            supabase.table("paper_chunks").insert(chunk_record).execute()
                            break
                        except Exception as chunk_err:
                            if attempt < 2:
                                time.sleep(2 * (attempt + 1))
                            else:
                                logger.error("Chunk insert failed after 3 attempts: %s", chunk_err)
            logger.info("Stored %d chunks in paper_chunks table", len(all_chunks))

    if not rerank_query:
        rerank_query = interest_text or "recent research"

    user_pool = list(processed_papers.values())
    logger.info("Reranking %d papers -> top %d", len(user_pool), TOP_MATCHES_PER_USER)

    if len(user_pool) > TOP_MATCHES_PER_USER:
        reranked = rerank_papers(
            query=rerank_query,
            papers=user_pool,
            top_n=TOP_MATCHES_PER_USER,
        )
    else:
        reranked = user_pool

    feed_items = 0
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
            feed_items += 1
        except Exception:
            pass

    try:
        from app.services.graph_pipeline_service import run_graph_pipeline
        new_ids = [pid for pid, _ in papers_to_embed]
        if new_ids:
            run_graph_pipeline(paper_ids=new_ids)
    except Exception as e:
        logger.error("[Graph Pipeline] Error (non-fatal): %s", e)

    logger.info("Bootstrap complete for user %s! %d feed items created.", user_id[:8], feed_items)
    return {"status": "success", "feed_items_created": feed_items}


def run_daily_pipeline():
    """
    LLM-optimized per-user pipeline:
      1. Load users + their cached optimized search profiles
      2. For each user -> fetch ~30/source with optimized queries
      3. Global dedup -> ArXiv PDF extract -> batch embed -> summarize
      4. For each user -> Cohere rerank -> save top 25 to feed
    """
    logger.info("=" * 60)
    logger.info("Starting PaperPulse Daily Pipeline (LLM-Optimized Queries)")
    logger.info("=" * 60)

    users_response = supabase.table("users").select("*").execute()
    users = users_response.data
    if not users:
        logger.info("No users found. Exiting.")
        return {"status": "success", "message": "No users to process"}

    logger.info("Processing %d user(s)", len(users))

    user_paper_ids: dict[str, set[str]] = {}
    all_raw_papers: list[dict] = []
    source_counts = {"arxiv": 0, "semantic_scholar": 0, "pubmed": 0, "openalex": 0}

    for user in users:
        user_id = user["id"]
        domains = user.get("domains", [])
        interest_text = user.get("interest_text", "") or ""
        user_paper_ids[user_id] = set()

        if not domains:
            logger.info("User %s... - no domains, skipping fetch", user_id[:8])
            continue

        optimized_raw = user.get("optimized_queries")
        if optimized_raw:
            try:
                optimized = json.loads(optimized_raw) if isinstance(optimized_raw, str) else optimized_raw
            except (json.JSONDecodeError, TypeError):
                optimized = None
        else:
            optimized = None

        if not optimized or not optimized.get("search_queries"):
            logger.info("User %s... - no cached queries, generating now...", user_id[:8])
            optimized = optimize_user_interests(interest_text, domains)
            try:
                supabase.table("users").update({
                    "optimized_queries": json.dumps(optimized)
                }).eq("id", user_id).execute()
            except Exception as e:
                logger.error("Failed to cache optimized queries for user %s: %s", user_id[:8], e)

        search_queries = optimized.get("search_queries", [])
        keywords = optimized.get("keywords", [])
        arxiv_categories = optimized.get("arxiv_categories", [])

        logger.info("User %s... - domains=%s, queries=%d",
                    user_id[:8], domains, len(search_queries))

        rerank_query = " ".join(search_queries) if search_queries else interest_text

        try:
            arxiv = fetch_arxiv(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
                arxiv_categories=arxiv_categories or None,
            )
            source_counts["arxiv"] += len(arxiv)
        except Exception as e:
            logger.error("[ArXiv] Fetch error for user %s: %s", user_id[:8], e)
            arxiv = []

        try:
            s2 = fetch_s2(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["semantic_scholar"] += len(s2)
        except Exception as e:
            logger.error("[S2] Fetch error for user %s: %s", user_id[:8], e)
            s2 = []

        try:
            pubmed = fetch_pubmed(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["pubmed"] += len(pubmed)
        except Exception as e:
            logger.error("[PubMed] Fetch error for user %s: %s", user_id[:8], e)
            pubmed = []

        try:
            openalex = fetch_openalex(
                domains, max_results=PER_SOURCE_LIMIT,
                search_queries=search_queries or None,
            )
            source_counts["openalex"] += len(openalex)
        except Exception as e:
            logger.error("[OpenAlex] Fetch error for user %s: %s", user_id[:8], e)
            openalex = []

        user_papers = arxiv + s2 + pubmed + openalex
        logger.info("  Fetched %d papers (ArXiv=%d, S2=%d, PubMed=%d, OpenAlex=%d)",
                    len(user_papers), len(arxiv), len(s2), len(pubmed), len(openalex))

        for p in user_papers:
            user_paper_ids[user_id].add(p.get("arxiv_id", ""))

        all_raw_papers.extend(user_papers)

    all_papers = _deduplicate_papers([all_raw_papers])
    logger.info("Total unique papers across all users: %d", len(all_papers))

    logger.info("--- Processing papers (embed + summarize) ---")
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

    logger.info("New papers to embed: %d (skipped %d existing)",
                len(papers_to_embed), len(all_papers) - len(papers_to_embed))

    arxiv_papers_to_extract = [
        (pid, rec) for pid, rec in papers_to_embed
        if rec.get("source") == "arxiv"
    ]
    full_texts: dict[str, str | None] = {}
    if arxiv_papers_to_extract:
        logger.info("Extracting full text from %d ArXiv PDFs...", len(arxiv_papers_to_extract))
        ids_to_extract = [pid for pid, _ in arxiv_papers_to_extract]
        full_texts = batch_extract_arxiv(ids_to_extract, rate_limit=1.0)

    if papers_to_embed:
        total_papers = len(papers_to_embed)
        for batch_start in range(0, total_papers, EMBEDDING_BATCH_SIZE):
            batch = papers_to_embed[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
            texts = [f"{p['title']}. {p['abstract']}" for _, p in batch]

            logger.info("Embedding batch %d (%d papers)...",
                        batch_start // EMBEDDING_BATCH_SIZE + 1, len(batch))
            embed_start = time.time()
            vectors = get_embeddings_batch(texts)
            logger.info("  Embedding completed in %.1fs", time.time() - embed_start)

            for idx, ((pid, paper_record), vector) in enumerate(zip(batch, vectors)):
                paper_record["abstract_vector"] = vector

                ft = full_texts.get(pid)
                if ft:
                    paper_record["full_text"] = ft

                paper_num = batch_start + idx + 1
                logger.info("  Summarizing paper %d/%d: %s",
                            paper_num, total_papers, paper_record["title"][:80])
                summ_start = time.time()
                summary = generate_paper_summary(paper_record["abstract"])
                paper_record["summary"] = summary
                logger.debug("    Summary generated in %.1fs", time.time() - summ_start)

                try:
                    supabase.table("papers").insert(paper_record).execute()
                except Exception as db_err:
                    logger.error("DB insert error for paper %s: %s", pid[:20], db_err)

                processed_papers[pid] = paper_record

    papers_with_text = [
        processed_papers[pid]
        for pid, _ in papers_to_embed
        if processed_papers.get(pid, {}).get("full_text")
    ]
    if papers_with_text:
        logger.info("Chunking %d full-text papers...", len(papers_with_text))
        all_chunks = batch_chunk_papers(papers_with_text)
        logger.info("Generated %d chunks total", len(all_chunks))

        if all_chunks:
            for batch_start in range(0, len(all_chunks), EMBEDDING_BATCH_SIZE):
                batch = all_chunks[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
                chunk_texts = [c["chunk_text"] for c in batch]

                logger.info("  Embedding chunk batch %d/%d (%d chunks)...",
                            batch_start // EMBEDDING_BATCH_SIZE + 1,
                            (len(all_chunks) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE,
                            len(batch))
                chunk_vectors = get_embeddings_batch(chunk_texts)

                for chunk, vector in zip(batch, chunk_vectors):
                    chunk_record = {
                        "paper_id": chunk["paper_id"],
                        "chunk_index": chunk["chunk_index"],
                        "chunk_text": chunk["chunk_text"],
                        "chunk_vector": vector,
                    }
                    for attempt in range(3):
                        try:
                            supabase.table("paper_chunks").insert(chunk_record).execute()
                            break
                        except Exception as chunk_err:
                            if attempt < 2:
                                time.sleep(2 * (attempt + 1))
                            else:
                                logger.error("Chunk insert failed after 3 attempts: %s", chunk_err)

            logger.info("Stored %d chunks in paper_chunks table", len(all_chunks))

    logger.info("--- Ranking papers per user (Cohere Rerank) ---")
    feed_items_created = 0

    for user in users:
        user_id = user["id"]
        interest_text = user.get("interest_text", "") or ""
        paper_ids_for_user = user_paper_ids.get(user_id, set())

        if not paper_ids_for_user:
            logger.info("Skipping user %s... (no papers fetched)", user_id[:8])
            continue

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

        user_pool = [
            processed_papers[pid]
            for pid in paper_ids_for_user
            if pid in processed_papers
        ]

        logger.info("User %s... - %d papers -> Cohere rerank -> top %d",
                     user_id[:8], len(user_pool), TOP_MATCHES_PER_USER)

        if len(user_pool) > TOP_MATCHES_PER_USER:
            reranked = rerank_papers(
                query=rerank_query,
                papers=user_pool,
                top_n=TOP_MATCHES_PER_USER,
            )
        else:
            reranked = user_pool

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
                pass  # UNIQUE constraint - already in feed

    logger.info("=" * 60)
    logger.info("Feed pipeline complete!")
    logger.info("  Users processed: %d", len(users))
    logger.info("  Unique papers: %d", len(processed_papers))
    logger.info("  Feed items created: %d", feed_items_created)
    logger.info("=" * 60)

    graph_result = {}
    try:
        from app.services.graph_pipeline_service import run_graph_pipeline
        new_paper_ids = [pid for pid, _ in papers_to_embed]
        if new_paper_ids:
            graph_result = run_graph_pipeline(paper_ids=new_paper_ids)
        else:
            logger.info("No new papers - skipping graph pipeline")
    except Exception as e:
        logger.error("[Graph Pipeline] Error (non-fatal): %s", e)
        graph_result = {"status": "error", "message": str(e)}

    return {
        "status": "success",
        "users_processed": len(users),
        "papers_processed": len(processed_papers),
        "feed_items_created": feed_items_created,
        "sources": source_counts,
        "graph": graph_result,
    }