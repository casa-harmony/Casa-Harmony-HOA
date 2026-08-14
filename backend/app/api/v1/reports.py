from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_active_tenant)])

@router.get("/catalog")
def catalog():
    # Return standard catalog, could be hardcoded since reports are scattered
    return [
        {"id": "board-delinquency-packet", "name": "Delinquency Packet", "category": "COLLECTIONS", "description": "Full board report showing aged arrears, cases, and active liens"},
        {"id": "compliance-health", "name": "Compliance Health Metrics", "category": "COMPLIANCE", "description": "Metrics and counts for compliance tracking"},
        {"id": "financial-cash-flow", "name": "Cash Flow Forecast", "category": "FINANCIAL", "description": "Cash flow trend analysis"}
    ]

@router.get("/{report_id}")
def run_report(report_id: str, format: str = "pdf"):
    # Mocking endpoint for frontend compatibility
    return {"status": "ok"}
