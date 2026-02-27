from fastapi import APIRouter
from app.services.pipeline_service import run_daily_pipeline

router = APIRouter(
    prefix="/pipeline",
    tags=["Admin"]
)

@router.post("/run", summary="Manually trigger the daily paper pipeline")
def trigger_pipeline():
    result = run_daily_pipeline()
    return result