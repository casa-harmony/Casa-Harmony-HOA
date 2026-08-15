from __future__ import annotations
import sys
import os

# Set environment variables for the script to use the production database
os.environ["DATABASE_URL"] = "postgresql+psycopg://casa_app:cGzGdvTH4hrELyHUk81sdX8F13ll@ep-lingering-moon-avsmka4u.c-11.us-east-1.aws.neon.tech/casa_harmony?sslmode=require"

from sqlalchemy import select, update
from app.core.database import session_for
from app.models.identity import User
from app.core.security import hash_password

def reset_password():
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        user = db.execute(select(User).where(User.email == "superadmin@casaharmony.ai")).scalar_one_or_none()
        if user:
            user.hashed_password = hash_password("ChangeMe!Superadmin1")
            db.commit()
            print("Password reset successfully.")
        else:
            print("User not found.")
    finally:
        db.close()

if __name__ == "__main__":
    reset_password()
