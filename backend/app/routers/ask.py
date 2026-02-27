from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.services.openai_service import get_embedding, answer_question_with_context

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

        # Call our new Supabase RPC function to find the top 5 most relevant papers
        # We pass the vector as a list, Supabase handles the conversion
        rpc_response = supabase.rpc(
            "match_user_papers",
            {
                "query_embedding": question_vector,
                "match_count": 5,
                "p_user_id": request.user_id
            }
        ).execute()

        relevant_papers = rpc_response.data
        
        if not relevant_papers:
             return {"answer": "You don't have any papers in your corpus yet! Wait for the daily pipeline to run.", "sources": []}

        print(f"Found {len(relevant_papers)} relevant papers. Generating answer...")

        # Pass the question and the fetched papers to GPT-4o
        final_response = answer_question_with_context(request.question, relevant_papers)
        
        return final_response

    except Exception as e:
        print(f"Error in Q&A pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))