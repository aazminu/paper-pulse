import logging
from fastapi import APIRouter, Depends, HTTPException
from app.database import supabase
from app.auth import get_current_user

logger = logging.getLogger("papers")

router = APIRouter(
    prefix="/papers",
    tags=["Papers"],
    dependencies=[Depends(get_current_user)]
)


@router.get("/{arxiv_id}", summary="Get a single paper by its arxiv_id / paper_id")
def get_paper(arxiv_id: str):
    """Return full paper metadata including summary and full_text."""
    try:
        response = supabase.table("papers") \
            .select("arxiv_id, title, authors, published_date, abstract, summary, url, source, doi, full_text") \
            .eq("arxiv_id", arxiv_id) \
            .execute()

        if not response.data:
            raise HTTPException(status_code=404, detail="Paper not found.")

        return response.data[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error fetching paper: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch paper.")
