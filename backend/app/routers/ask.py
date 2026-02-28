from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import get_embedding, answer_question_with_context
from app.services.rerank_service import rerank_for_qa, rerank_chunks

router = APIRouter(
    prefix="/ask",
    tags=["Q&A"]
)

class AskRequest(BaseModel):
    user_id: str
    question: str

@router.post("/", summary="Ask a question against your paper corpus")
def ask_question(request: AskRequest):
    try:
        print(f"🤔 User {request.user_id} asked: {request.question}")
        
        # Embed the user's question
        question_vector = get_embedding(request.question)
        if not question_vector:
            raise HTTPException(status_code=500, detail="Failed to embed question.")

        # -----------------------------------------------------------
        # Strategy: Chunk-level search → group by paper → GPT-5.2
        # Falls back to paper-level search if no chunks exist yet.
        # -----------------------------------------------------------

        # Try chunk-level search first (much more precise)
        chunk_results = []
        try:
            chunk_rpc = supabase.rpc(
                "match_paper_chunks",
                {
                    "query_embedding": question_vector,
                    "match_count": 40,
                    "p_user_id": request.user_id,
                }
            ).execute()
            chunk_results = chunk_rpc.data or []
        except Exception as e:
            print(f"  Chunk search failed (table may not exist yet): {e}")

        if chunk_results:
            print(f"  Found {len(chunk_results)} relevant chunks")

            # Rerank chunks with Cohere for maximum precision
            reranked_chunks = rerank_chunks(
                question=request.question,
                chunks=chunk_results,
                top_n=20,
            )

            # Group chunks by paper, preserving best chunks per paper
            paper_chunks: dict[str, list[dict]] = {}
            paper_ids_ordered: list[str] = []
            for chunk in reranked_chunks:
                pid = chunk["paper_id"]
                if pid not in paper_chunks:
                    paper_chunks[pid] = []
                    paper_ids_ordered.append(pid)
                paper_chunks[pid].append(chunk)

            # Fetch parent paper metadata for each unique paper
            context_papers = []
            for pid in paper_ids_ordered:
                paper_resp = (
                    supabase.table("papers")
                    .select("arxiv_id, title, authors, abstract, url, source")
                    .eq("arxiv_id", pid)
                    .execute()
                )
                if not paper_resp.data:
                    continue

                paper = paper_resp.data[0]
                # Attach the best chunks as the paper's "full_text" for context
                best_chunks = paper_chunks[pid]
                # Sort by chunk_index for reading order
                best_chunks.sort(key=lambda c: c.get("chunk_index", 0))
                paper["full_text"] = "\n\n".join(c["chunk_text"] for c in best_chunks)
                context_papers.append(paper)

            print(f"  Grouped into {len(context_papers)} papers. "
                  f"Generating answer with GPT-5.2...")

            final_response = answer_question_with_context(
                request.question, context_papers
            )
            return final_response

        # -----------------------------------------------------------
        # Fallback: paper-level search (no chunks available)
        # -----------------------------------------------------------
        print("  No chunks found — falling back to paper-level search")

        rpc_response = supabase.rpc(
            "match_user_papers",
            {
                "query_embedding": question_vector,
                "match_count": 50,
                "p_user_id": request.user_id
            }
        ).execute()

        relevant_papers = rpc_response.data
        
        if not relevant_papers:
             return {"answer": "You don't have any papers in your corpus yet! Wait for the daily pipeline to run.", "sources": []}

        # rerank top 50 to top 25 most relevant to the question
        reranked_papers = rerank_for_qa(
            question=request.question,
            papers=relevant_papers,
            top_n=25,
        )

        print(f"Retrieved {len(relevant_papers)} papers, reranked to {len(reranked_papers)}. Generating answer with GPT-5.2...")

        # Pass the reranked papers to GPT-5.2
        final_response = answer_question_with_context(request.question, reranked_papers)
        
        return final_response

    except Exception as e:
        print(f"Error in Q&A pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))