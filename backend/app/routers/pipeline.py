from fastapi import APIRouter, BackgroundTasks
from app.services.pipeline_service import run_daily_pipeline

router = APIRouter(
    prefix="/pipeline",
    tags=["Admin"]
)

# Store latest pipeline result for polling
_pipeline_status = {"running": False, "last_result": None}

def _run_pipeline_bg():
    global _pipeline_status
    _pipeline_status["running"] = True
    try:
        result = run_daily_pipeline()
        _pipeline_status["last_result"] = result
    except Exception as e:
        _pipeline_status["last_result"] = {"status": "error", "message": str(e)}
    finally:
        _pipeline_status["running"] = False

@router.post("/run", summary="Manually trigger the daily paper pipeline")
def trigger_pipeline(background_tasks: BackgroundTasks):
    if _pipeline_status["running"]:
        return {"status": "already_running", "message": "Pipeline is already in progress"}
    background_tasks.add_task(_run_pipeline_bg)
    return {"status": "started", "message": "Pipeline started in background"}

@router.get("/status", summary="Check pipeline status")
def pipeline_status():
    return _pipeline_status