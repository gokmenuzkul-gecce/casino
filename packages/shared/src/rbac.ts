import { UserRole, ADMIN_ROLES } from "./enums.js";

/** Fine-grained permission strings, grouped by domain. */
export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",

  USER_VIEW: "user:view",
  USER_EDIT: "user:edit",
  USER_SUSPEND: "user:suspend",
  USER_RESET_PASSWORD: "user:reset_password",
  USER_IMPERSONATE: "user:impersonate",
  USER_ROLE_ASSIGN: "user:role_assign",
  USER_BALANCE_ADJUST: "user:balance_adjust",
  USER_EXPORT: "user:export",

  KYC_VIEW: "kyc:view",
  KYC_REVIEW: "kyc:review",

  PAYMENT_VIEW: "payment:view",
  PAYMENT_DEPOSIT_APPROVE: "payment:deposit_approve",
  PAYMENT_WITHDRAWAL_APPROVE: "payment:withdrawal_approve",
  PAYMENT_METHOD_MANAGE: "payment:method_manage",
  PAYMENT_CHARGEBACK: "payment:chargeback",

  GAME_VIEW: "game:view",
  GAME_EDIT: "game:edit",
  GAME_PUBLISH: "game:publish",
  GAME_RTP_CONFIG: "game:rtp_config",
  GAME_JACKPOT_MANAGE: "game:jackpot_manage",

  BONUS_VIEW: "bonus:view",
  BONUS_CREATE: "bonus:create",
  BONUS_EDIT: "bonus:edit",
  BONUS_APPROVE: "bonus:approve",

  TOURNAMENT_VIEW: "tournament:view",
  TOURNAMENT_MANAGE: "tournament:manage",

  VIP_VIEW: "vip:view",
  VIP_MANAGE: "vip:manage",

  AFFILIATE_VIEW: "affiliate:view",
  AFFILIATE_MANAGE: "affiliate:manage",
  AFFILIATE_PAYOUT: "affiliate:payout",

  CMS_VIEW: "cms:view",
  CMS_EDIT: "cms:edit",
  CMS_PUBLISH: "cms:publish",

  REPORT_VIEW: "report:view",
  REPORT_EXPORT: "report:export",
  REPORT_FINANCE: "report:finance",

  RISK_VIEW: "risk:view",
  RISK_MANAGE: "risk:manage",
  RISK_BLOCKLIST: "risk:blocklist",

  AUDIT_VIEW: "audit:view",

  SETTINGS_VIEW: "settings:view",
  SETTINGS_EDIT: "settings:edit",
  SETTINGS_PROVIDERS: "settings:providers",
  SETTINGS_FEATURE_FLAGS: "settings:feature_flags",

  ADMIN_VIEW: "admin:view",
  ADMIN_CREATE: "admin:create",
  ADMIN_EDIT: "admin:edit",
  ADMIN_DELETE: "admin:delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL: Permission[] = Object.values(PERMISSIONS);

const SUPPORT_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.USER_RESET_PASSWORD,
  PERMISSIONS.USER_IMPERSONATE,
  PERMISSIONS.KYC_VIEW,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.GAME_VIEW,
  PERMISSIONS.BONUS_VIEW,
  PERMISSIONS.CMS_VIEW,
  PERMISSIONS.RISK_VIEW,
];

const KYC_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.KYC_VIEW,
  PERMISSIONS.KYC_REVIEW,
  PERMISSIONS.RISK_VIEW,
  PERMISSIONS.RISK_MANAGE,
  PERMISSIONS.RISK_BLOCKLIST,
  PERMISSIONS.AUDIT_VIEW,
];

const PAYMENTS_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.KYC_VIEW,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.PAYMENT_DEPOSIT_APPROVE,
  PERMISSIONS.PAYMENT_WITHDRAWAL_APPROVE,
  PERMISSIONS.PAYMENT_METHOD_MANAGE,
  PERMISSIONS.PAYMENT_CHARGEBACK,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.REPORT_FINANCE,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.AUDIT_VIEW,
];

const RISK_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.USER_SUSPEND,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.RISK_VIEW,
  PERMISSIONS.RISK_MANAGE,
  PERMISSIONS.RISK_BLOCKLIST,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.AUDIT_VIEW,
];

const AFFILIATE_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.AFFILIATE_VIEW,
  PERMISSIONS.AFFILIATE_MANAGE,
  PERMISSIONS.AFFILIATE_PAYOUT,
  PERMISSIONS.REPORT_VIEW,
  PERMISSIONS.REPORT_EXPORT,
];

const MARKETING_PERMS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.USER_VIEW,
  PERMISSIONS.BONUS_VIEW,
  PERMISSIONS.BONUS_CREATE,
  PERMISSIONS.BONUS_EDIT,
  PERMISSIONS.TOURNAMENT_VIEW,
  PERMISSIONS.TOURNAMENT_MANAGE,
  PERMISSIONS.VIP_VIEW,
  PERMISSIONS.VIP_MANAGE,
  PERMISSIONS.CMS_VIEW,
  PERMISSIONS.CMS_EDIT,
  PERMISSIONS.CMS_PUBLISH,
  PERMISSIONS.REPORT_VIEW,
];

const ADMIN_PERMS: Permission[] = ALL.filter((p) => !p.startsWith("admin:delete"));

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.PLAYER]: [],
  [UserRole.SUPPORT]: SUPPORT_PERMS,
  [UserRole.KYC_OFFICER]: KYC_PERMS,
  [UserRole.PAYMENTS]: PAYMENTS_PERMS,
  [UserRole.RISK]: RISK_PERMS,
  [UserRole.AFFILIATE_MANAGER]: AFFILIATE_PERMS,
  [UserRole.MARKETING]: MARKETING_PERMS,
  [UserRole.ADMIN]: ADMIN_PERMS,
  [UserRole.SUPER_ADMIN]: ALL,
};

export function permissionsFor(roles: UserRole[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) set.add(perm);
  }
  return set;
}

export function hasPermission(roles: UserRole[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function isStaff(roles: UserRole[]): boolean {
  return roles.some(isAdminRole);
}
