from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import get_embedding, answer_question_with_context
from app.services.rerank_service import rerank_for_qa

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

        # Retrieve top 50 papers by vector similarity from Supabase
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