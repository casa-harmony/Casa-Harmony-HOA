"""Aggregate model imports so Alembic autogenerate & mapper config see them all."""
from app.models.base import Base  # noqa: F401
from app.models.identity import (  # noqa: F401
    Membership,
    Permission,
    Role,
    RolePermission,
    Tenant,
    User,
)
from app.models.audit import AuditLog  # noqa: F401
from app.models.kff import (  # noqa: F401
    MAX_SEGMENTS,
    GlCodeCombination,
    KffCrossValidationRule,
    KffCrossValidationRuleLine,
    KffSegment,
    KffStructure,
    KffValueSet,
    KffValueSetValue,
)
from app.models.compliance import DataSubjectRequest, PaymentToken  # noqa: F401
from app.models.subledger import (  # noqa: F401
    ArHomeowner,
    ArInvoice,
    ArReceipt,
    GlJournal,
    GlJournalLine,
)
from app.models.masters import (  # noqa: F401
    ApSupplier,
    FndLookup,
    PaymentTerm,
    VendorType,
)
from app.models.distribution_set import (  # noqa: F401
    DistributionSet,
    DistributionSetLine,
)
from app.models.supplier_ext import (  # noqa: F401
    ApSupplierBankAccount,
    ApSupplierContact,
    ApSupplierSite,
)
from app.models.payments import (  # noqa: F401
    ApInvoicePayment,
    ApPayment,
    ApPaymentSchedule,
    PaymentMethod,
)
from app.models.banking import (  # noqa: F401
    ApBank,
    ApBankAccount,
    ApBankAccountUse,
)
from app.models.procurement import PoDistribution, PoHeader, PoLine  # noqa: F401
from app.models.payables import (  # noqa: F401
    ApInvoice,
    ApInvoiceDistribution,
    ApInvoiceLine,
)
from app.models.gl import (  # noqa: F401
    GlBalance,
    GlJeBatch,
    GlJeHeader,
    GlJeLine,
)
from app.models.workflow import (  # noqa: F401
    ApprovalAction,
    ApprovalHierarchy,
    ApprovalRequest,
    ApprovalRule,
)
from app.models.service_desk import ServiceTicket, ServiceTicketComment  # noqa: F401
from app.models.budget import GlBudget  # noqa: F401
from app.models.resident import Resident, ResidentUnit  # noqa: F401
from app.models.otp import ResidentOtpChallenge  # noqa: F401
from app.models.dev_mailbox import CapturedMessage  # noqa: F401
from app.models.notifications import ApMatchTolerance, Notification  # noqa: F401
from app.models.receiving import (  # noqa: F401
    RcvShipmentHeader,
    RcvShipmentLine,
    RcvTransaction,
)
from app.models.cash import (  # noqa: F401
    CeBankAccount,
    CeStatementHeader,
    CeStatementLine,
)
from app.models.encumbrance import EncumbranceSettings, PoEncumbrance  # noqa: F401
from app.models.period import AccountingPeriod  # noqa: F401
from app.models.golive import ComplianceItem  # noqa: F401
from app.models.golive_status import BackupRun, GoLiveStatus  # noqa: F401
from app.models.ar_billing import BillingPlan, BillingPlanLine, LateFeeRule  # noqa: F401
from app.models.documents import DocumentAttachment  # noqa: F401
from app.models.collections import (  # noqa: F401
    DelinquencyCase,
    Lien,
    PaymentPlan,
    PaymentPlanInstallment,
)
from app.models.statements import StatementDelivery, StatementRun  # noqa: F401
from app.models.scheduling import ScheduledJobRun, SchedulerConfig  # noqa: F401
from app.models.payment_gateway import GatewayConfig, GatewayTransaction  # noqa: F401
from app.models.dunning import DunningLog, DunningRule  # noqa: F401
from app.models.migration import MigrationBatch, MigrationRecord  # noqa: F401
from app.models.budgeting import (  # noqa: F401
    BudgetControlSettings,
    BudgetLine,
    BudgetVersion,
)
from app.models.fixed_assets import (  # noqa: F401
    FaAsset,
    FaDepreciationEntry,
    ReserveComponent,
    ReserveStudy,
)

__all__ = [
    "Base",
    "Tenant",
    "User",
    "Role",
    "Permission",
    "RolePermission",
    "Membership",
    "AuditLog",
    "KffStructure",
    "KffSegment",
    "KffValueSet",
    "KffValueSetValue",
    "KffCrossValidationRule",
    "KffCrossValidationRuleLine",
    "GlCodeCombination",
    "PaymentToken",
    "DataSubjectRequest",
    "GlJournal",
    "GlJournalLine",
    "ArHomeowner",
    "ArInvoice",
    "ArReceipt",
    "FndLookup",
    "ApSupplier",
    "PaymentTerm",
    "VendorType",
    "DistributionSet",
    "DistributionSetLine",
    "ApSupplierSite",
    "ApSupplierContact",
    "ApSupplierBankAccount",
    "PaymentMethod",
    "ApPaymentSchedule",
    "ApPayment",
    "ApInvoicePayment",
    "ApBank",
    "ApBankAccount",
    "ApBankAccountUse",
    "PoHeader",
    "PoLine",
    "PoDistribution",
    "ApInvoice",
    "ApInvoiceLine",
    "ApInvoiceDistribution",
    "GlJeBatch",
    "GlJeHeader",
    "GlJeLine",
    "GlBalance",
    "ApprovalHierarchy",
    "ApprovalRule",
    "ApprovalRequest",
    "ApprovalAction",
    "ServiceTicket",
    "ServiceTicketComment",
    "GlBudget",
    "Resident",
    "ResidentUnit",
    "ResidentOtpChallenge",
    "CapturedMessage",
    "Notification",
    "ApMatchTolerance",
    "RcvShipmentHeader",
    "RcvShipmentLine",
    "RcvTransaction",
    "CeBankAccount",
    "CeStatementHeader",
    "CeStatementLine",
    "EncumbranceSettings",
    "PoEncumbrance",
    "AccountingPeriod",
    "ComplianceItem",
    "GoLiveStatus",
    "BackupRun",
    "BillingPlan",
    "BillingPlanLine",
    "LateFeeRule",
    "DocumentAttachment",
    "DelinquencyCase",
    "PaymentPlan",
    "PaymentPlanInstallment",
    "Lien",
    "StatementRun",
    "StatementDelivery",
    "SchedulerConfig",
    "ScheduledJobRun",
    "GatewayConfig",
    "GatewayTransaction",
    "DunningRule",
    "DunningLog",
    "MigrationBatch",
    "MigrationRecord",
    "BudgetVersion",
    "BudgetLine",
    "BudgetControlSettings",
    "FaAsset",
    "FaDepreciationEntry",
    "ReserveStudy",
    "ReserveComponent",
    "MAX_SEGMENTS",
]
