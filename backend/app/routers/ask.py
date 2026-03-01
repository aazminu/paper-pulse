import json as _json
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import (
    get_embedding,
    answer_question_with_context,
    answer_question_multimodal,
    stream_answer_with_context,
    stream_answer_multimodal,
    classify_query_intent,
)
from app.services.rerank_service import rerank_for_qa, rerank_chunks
from app.services.file_processor import process_file, MAX_FILE_SIZE

router = APIRouter(
    prefix="/ask",
    tags=["Q&A"]
)


def _get_graph_context(paper_ids: list[str]) -> str:
    """Fetch knowledge-graph context for retrieved papers (non-fatal)."""
    try:
        from app.services.neo4j_service import get_graph_context_for_query
        return get_graph_context_for_query(paper_ids)
    except Exception as e:
        print(f"  [GraphRAG] Graph context unavailable: {e}")
        return ""

class AskRequest(BaseModel):
    user_id: str
    question: str
    history: list[dict] | None = None


# ── Stop words for title matching ──────────────────────────────────────────
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "were", "been", "be", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "can", "shall",
    "about", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again", "then",
    "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "explain", "what", "paper", "describe", "tell", "me",
    "summarize", "summary", "overview", "details", "using", "based",
    "its", "my", "your", "our", "their", "i", "we", "you", "they",
}


def _find_title_matches(question: str, user_id: str) -> list[dict]:
    """
    Find papers in the user's feed whose titles closely match words in the
    question.  This catches cases like "explain this paper: <title>" that
    vector search can miss.
    """
    try:
        # 1. Get paper IDs in the user's feed
        feed_resp = (
            supabase.table("feed_items")
            .select("paper_id")
            .eq("user_id", user_id)
            .execute()
        )
        if not feed_resp.data:
            return []

        paper_ids = list({fi["paper_id"] for fi in feed_resp.data})

        # 2. Fetch metadata for all of the user's papers
        papers_resp = (
            supabase.table("papers")
            .select("arxiv_id, title, authors, abstract, url, source, full_text, summary")
            .in_("arxiv_id", paper_ids)
            .execute()
        )
        if not papers_resp.data:
            return []

        # 3. Score each paper by significant-word overlap with the question
        q_words = {
            w.strip(".,;:!?\"'()-").lower()
            for w in question.split()
        }
        q_words = {w for w in q_words if len(w) > 2 and w not in _STOP_WORDS}

        scored: list[tuple[float, int, dict]] = []
        for paper in papers_resp.data:
            t_words = {
                w.strip(".,;:!?\"'()-").lower()
                for w in paper["title"].split()
            }
            t_words = {w for w in t_words if len(w) > 2 and w not in _STOP_WORDS}
            if not t_words:
                continue

            overlap = len(q_words & t_words)
            ratio = overlap / len(t_words)

            # Require at least 3 matching words AND 40 % of title words
            if overlap >= 3 and ratio >= 0.4:
                scored.append((ratio, overlap, paper))

        scored.sort(key=lambda x: (-x[0], -x[1]))
        return [paper for _, _, paper in scored[:3]]

    except Exception as e:
        print(f"  Title matching failed: {e}")
        return []


def _retrieve_context(question_vector: list[float], user_id: str, question: str) -> list[dict]:
    """
    Hybrid retrieval: title matching + chunk-level vector search + paper-level fallback.
    Title matches are always included so explicitly named papers are never missed.
    """

    # ── 1. Title-based lookup ─────────────────────────────────────────────
    title_matches = _find_title_matches(question, user_id)
    if title_matches:
        print(
            f"  Title match found {len(title_matches)} paper(s): "
            + ", ".join(p['title'][:60] for p in title_matches)
        )

    # ── 2. Chunk-level vector search ──────────────────────────────────────
    chunk_results = []
    try:
        chunk_rpc = supabase.rpc(
            "match_paper_chunks",
            {
                "query_embedding": question_vector,
                "match_count": 40,
                "p_user_id": user_id,
            }
        ).execute()
        chunk_results = chunk_rpc.data or []
    except Exception as e:
        print(f"  Chunk search failed (table may not exist yet): {e}")

    vector_papers: list[dict] = []

    if chunk_results:
        print(f"  Found {len(chunk_results)} relevant chunks")

        reranked_chunks = rerank_chunks(
            question=question,
            chunks=chunk_results,
            top_n=20,
        )

        paper_chunks: dict[str, list[dict]] = {}
        paper_ids_ordered: list[str] = []
        for chunk in reranked_chunks:
            pid = chunk["paper_id"]
            if pid not in paper_chunks:
                paper_chunks[pid] = []
                paper_ids_ordered.append(pid)
            paper_chunks[pid].append(chunk)

        for pid in paper_ids_ordered:
            paper_resp = (
                supabase.table("papers")
                .select("arxiv_id, title, authors, abstract, url, source, summary, published_date, doi")
                .eq("arxiv_id", pid)
                .execute()
            )
            if not paper_resp.data:
                continue
            paper = paper_resp.data[0]
            best_chunks = paper_chunks[pid]
            best_chunks.sort(key=lambda c: c.get("chunk_index", 0))
            paper["full_text"] = "\n\n".join(c["chunk_text"] for c in best_chunks)
            vector_papers.append(paper)
    else:
        # Fallback: paper-level vector search
        print("  No chunks found, falling back to paper-level search")
        rpc_response = supabase.rpc(
            "match_user_papers",
            {
                "query_embedding": question_vector,
                "match_count": 50,
                "p_user_id": user_id,
            }
        ).execute()

        relevant_papers = rpc_response.data or []
        if relevant_papers:
            vector_papers = rerank_for_qa(
                question=question, papers=relevant_papers, top_n=25
            )

    # ── 3. Merge: title matches first, then vector results (deduped) ─────
    seen_ids: set[str] = set()
    merged: list[dict] = []

    for paper in title_matches:
        pid = paper["arxiv_id"]
        if pid not in seen_ids:
            seen_ids.add(pid)
            merged.append(paper)

    for paper in vector_papers:
        pid = paper["arxiv_id"]
        if pid not in seen_ids:
            seen_ids.add(pid)
            merged.append(paper)

    return merged


@router.post("/", summary="Ask a question against your paper corpus (text only)")
def ask_question(request: AskRequest):
    """Text-only Q&A endpoint with conversation history and smart retrieval."""
    try:
        print(f"🤔 User {request.user_id} asked: {request.question}")

        history = request.history or []
        intent = classify_query_intent(request.question, len(history) > 0)
        print(f"  Intent: {intent}")

        # General questions (e.g. "what is 9+10") — no retrieval needed
        if intent == "general":
            return answer_question_with_context(request.question, [], history=history)

        # Follow-ups — the model already has context from conversation history
        if intent == "follow_up":
            return answer_question_with_context(request.question, [], history=history)

        # Retrieval — full pipeline
        question_vector = get_embedding(request.question)
        if not question_vector:
            raise HTTPException(status_code=500, detail="Failed to embed question.")

        context_papers = _retrieve_context(question_vector, request.user_id, request.question)
        if not context_papers:
            return {
                "answer": "You don't have any papers in your corpus yet! Wait for the daily pipeline to run.",
                "sources": [],
            }

        # Enrich with knowledge graph context
        graph_context = _get_graph_context([p["arxiv_id"] for p in context_papers])

        print(f"  {len(context_papers)} papers retrieved. Generating answer with gpt-4.1...")
        return answer_question_with_context(
            request.question, context_papers, history=history,
            graph_context=graph_context,
        )

    except Exception as e:
        print(f"Error in Q&A pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/multimodal", summary="Ask with files: images, PDFs, audio, video, docs")
async def ask_multimodal(
    user_id: str = Form(...),
    question: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    history: str = Form(default="[]"),
):
    """
    Multimodal Q&A endpoint with conversation history.
    Accepts text + files + history (JSON-encoded list of message dicts).
    """
    try:
        import json as _json
        parsed_history: list[dict] = _json.loads(history) if history else []
    except Exception:
        parsed_history = []

    try:
        print(f"🤔 Multimodal ask from {user_id}: '{question}' + {len(files)} file(s)")

        # Process uploaded files
        attachments: list[dict] = []
        file_text_for_embedding: list[str] = []

        for upload in files:
            file_bytes = await upload.read()

            if len(file_bytes) > MAX_FILE_SIZE:
                print(f"  Skipping {upload.filename}: exceeds 25MB limit")
                continue

            content_type = upload.content_type or "application/octet-stream"
            filename = upload.filename or "file"

            print(f"  Processing: {filename} ({content_type}, {len(file_bytes)} bytes)")
            result = process_file(file_bytes, content_type, filename)

            if result is None:
                print(f"  Unsupported file type: {content_type}")
                continue

            attachments.append(result)

            # Collect text content for embedding-based retrieval
            if result["type"] == "text" and result.get("content"):
                file_text_for_embedding.append(result["content"][:2000])

        # Build combined query for retrieval
        combined_query = question
        if file_text_for_embedding:
            # Add a snippet of file content to improve paper retrieval
            extra = " ".join(file_text_for_embedding)[:500]
            combined_query = f"{question} {extra}".strip()

        if not combined_query:
            return {
                "answer": "Please provide a question or attach a file to analyze.",
                "sources": [],
            }

        # Retrieve relevant papers
        question_vector = get_embedding(combined_query)
        if not question_vector:
            raise HTTPException(status_code=500, detail="Failed to embed question.")

        context_papers = _retrieve_context(question_vector, user_id, combined_query)

        # Enrich with knowledge graph context
        graph_context = _get_graph_context([p["arxiv_id"] for p in context_papers])

        print(f"  {len(context_papers)} papers, {len(attachments)} attachments. Generating answer...")

        # Use multimodal answer function
        return answer_question_multimodal(
            question=question or "Analyze the attached file(s) and relate to my papers.",
            context_papers=context_papers,
            attachments=attachments,
            history=parsed_history,
            graph_context=graph_context,
        )

    except Exception as e:
        print(f"Error in multimodal Q&A: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# STREAMING (SSE) ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

def _sse(event: str, data) -> str:
    """Format a server-sent event line."""
    payload = _json.dumps(data) if not isinstance(data, str) else data
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/stream", summary="Stream an answer via SSE (text only)")
def ask_stream(request: AskRequest):
    """
    SSE events emitted:
      stage   → {"stage": "...", "message": "..."}
      sources → [{paper}, ...]
      token   → {"t": "..."}
      done    → {}
      error   → {"message": "..."}
    """
    def generate():
        try:
            history = request.history or []

            # 1. classify
            yield _sse("stage", {"stage": "classifying", "message": "Understanding your question…"})
            intent = classify_query_intent(request.question, len(history) > 0)

            if intent in ("general", "follow_up"):
                label = "Generating answer…" if intent == "general" else "Continuing conversation…"
                yield _sse("stage", {"stage": "generating", "message": label})
                yield _sse("sources", [])
                for tok in stream_answer_with_context(request.question, [], history=history):
                    yield _sse("token", {"t": tok})
                yield _sse("done", {})
                return

            # 2. embed + search
            yield _sse("stage", {"stage": "searching", "message": "Searching your paper library…"})
            question_vector = get_embedding(request.question)
            if not question_vector:
                yield _sse("error", {"message": "Failed to embed question."})
                return
            context_papers = _retrieve_context(question_vector, request.user_id, request.question)

            # 3. graph
            yield _sse("stage", {"stage": "graphing", "message": "Querying knowledge graph…"})
            graph_context = _get_graph_context(
                [p["arxiv_id"] for p in context_papers]
            ) if context_papers else ""

            # send sources
            yield _sse("sources", [
                {
                    "arxiv_id": p.get("arxiv_id", ""),
                    "title": p.get("title", ""),
                    "authors": p.get("authors", []),
                    "source": p.get("source", ""),
                    "url": p.get("url", ""),
                    "published_date": str(p.get("published_date", "")),
                }
                for p in context_papers
            ])

            # 4. stream LLM
            yield _sse("stage", {"stage": "generating", "message": "Generating answer…"})
            for tok in stream_answer_with_context(
                request.question, context_papers,
                history=history, graph_context=graph_context,
            ):
                yield _sse("token", {"t": tok})

            yield _sse("done", {})

        except Exception as e:
            print(f"Error in streaming Q&A: {e}")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"},
    )


@router.post("/stream/multimodal", summary="Stream a multimodal answer via SSE")
async def ask_stream_multimodal(
    user_id: str = Form(...),
    question: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    history: str = Form(default="[]"),
):
    """SSE streaming for multimodal (files + text) queries."""
    try:
        parsed_history: list[dict] = _json.loads(history) if history else []
    except Exception:
        parsed_history = []

    # read file bytes before entering sync generator
    attachments: list[dict] = []
    file_text_parts: list[str] = []
    for upload in files:
        raw = await upload.read()
        if len(raw) > MAX_FILE_SIZE:
            continue
        ct = upload.content_type or "application/octet-stream"
        fn = upload.filename or "file"
        result = process_file(raw, ct, fn)
        if result is None:
            continue
        attachments.append(result)
        if result["type"] == "text" and result.get("content"):
            file_text_parts.append(result["content"][:2000])

    combined_query = question
    if file_text_parts:
        combined_query = f"{question} {' '.join(file_text_parts)[:500]}".strip()

    def generate():
        try:
            if not combined_query:
                yield _sse("error", {"message": "Provide a question or attach a file."})
                return

            yield _sse("stage", {"stage": "searching", "message": "Searching your paper library…"})
            question_vector = get_embedding(combined_query)
            if not question_vector:
                yield _sse("error", {"message": "Failed to embed question."})
                return
            context_papers = _retrieve_context(question_vector, user_id, combined_query)

            yield _sse("stage", {"stage": "graphing", "message": "Querying knowledge graph…"})
            graph_context = _get_graph_context(
                [p["arxiv_id"] for p in context_papers]
            ) if context_papers else ""

            yield _sse("sources", [
                {
                    "arxiv_id": p.get("arxiv_id", ""),
                    "title": p.get("title", ""),
                    "authors": p.get("authors", []),
                    "source": p.get("source", ""),
                    "url": p.get("url", ""),
                    "published_date": str(p.get("published_date", "")),
                }
                for p in context_papers
            ])

            yield _sse("stage", {"stage": "generating", "message": "Generating answer…"})
            final_q = question or "Analyze the attached file(s) and relate to my papers."
            for tok in stream_answer_multimodal(
                question=final_q,
                context_papers=context_papers,
                attachments=attachments,
                history=parsed_history,
                graph_context=graph_context,
            ):
                yield _sse("token", {"t": tok})

            yield _sse("done", {})

        except Exception as e:
            print(f"Error in multimodal streaming: {e}")
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"},
    )