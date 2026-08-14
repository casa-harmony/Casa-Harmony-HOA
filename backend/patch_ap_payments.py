import sys

def patch_services():
    with open("app/services/ap_payments.py", "r") as f:
        content = f.read()
    
    if "def clear_payment" not in content:
        content += """

def clear_payment(db, payment: ApPayment, created_by=None):
    if payment.status != "CREATED":
        raise PaymentError("Can only clear a CREATED payment")
    payment.status = "CLEARED"
    db.flush()
    return payment
"""
        with open("app/services/ap_payments.py", "w") as f:
            f.write(content)

def patch_api():
    with open("app/api/v1/ap_payments.py", "r") as f:
        content = f.read()

    if "def clear_payment" not in content:
        content += """

@router.post("/{payment_id}/clear", response_model=PaymentOut)
def clear_payment(payment_id: uuid.UUID, db: Session = Depends(get_db),
                 principal: Principal = Depends(require_permission("ap.pay"))):
    p = _get_payment(db, payment_id, principal.tenant_id)
    try:
        ap_payments.clear_payment(db, p, created_by=principal.user.id)
    except PaymentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CLEAR", entity_type="ApPayment", entity_id=p.id)
    return p
"""
        with open("app/api/v1/ap_payments.py", "w") as f:
            f.write(content)

patch_services()
patch_api()
