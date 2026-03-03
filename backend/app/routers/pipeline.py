from fastapi import APIRouter, BackgroundTasks, Depends
from app.services.pipeline_service import run_daily_pipeline, run_single_user_pipeline
from app.auth import get_current_user, require_admin

router = APIRouter(
    prefix="/pipeline",
    tags=["Admin"]
)

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

@router.post("/run", summary="Manually trigger the daily paper pipeline", dependencies=[Depends(require_admin)])
def trigger_pipeline(background_tasks: BackgroundTasks):
    if _pipeline_status["running"]:
        return {"status": "already_running", "message": "Pipeline is already in progress"}
    background_tasks.add_task(_run_pipeline_bg)
    return {"status": "started", "message": "Pipeline started in background"}

@router.post("/bootstrap/{user_id}", summary="Run pipeline for a single new user")
def bootstrap_user(user_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    if current_user["id"] != user_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Access denied")
    background_tasks.add_task(run_single_user_pipeline, user_id)
    return {"status": "started", "message": "Bootstrapping feed for new user"}

@router.get("/status", summary="Check pipeline status", dependencies=[Depends(require_admin)])
def pipeline_status():
    return _pipeline_status