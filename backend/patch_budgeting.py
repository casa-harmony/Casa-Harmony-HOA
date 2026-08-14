import sys

def patch_api():
    with open("app/api/v1/budgeting.py", "r") as f:
        content = f.read()

    if "def budget_lines" not in content:
        content += """

@router.get("/lines", response_model=list[BvARow])
def budget_lines(db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("report.read"))):
    control = budgeting.get_control(db, p.tenant_id)
    if not control.controlling_version_id:
        return []
    try:
        return budgeting.budget_vs_actual(db, p.tenant_id, control.controlling_version_id)
    except BudgetError as exc:
        _err(exc)
"""
        with open("app/api/v1/budgeting.py", "w") as f:
            f.write(content)

patch_api()
