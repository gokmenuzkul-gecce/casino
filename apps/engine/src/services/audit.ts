import { prisma } from "@aurora/db";
import { AuditAction } from "@aurora/shared";

export interface AuditInput {
  actorId?: string;
  actorRole?: string;
  action: AuditAction | string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
}

/**
 * Append-only audit trail. Every privileged action and every money movement
 * writes here, which is what makes the platform defensible in a licensing
 * review. Writes never throw into the caller path: an audit failure must not
 * break a player action, but it is logged loudly.
 */
export class AuditService {
  async log(input: AuditInput): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: (input.before ?? undefined) as never,
          after: (input.after ?? undefined) as never,
          ip: input.ip,
          userAgent: input.userAgent,
          severity: input.severity ?? "INFO",
        },
      });
    } catch (error) {
      console.error("[audit] yazilamadi", error);
    }
  }

  async list(params: {
    page: number;
    pageSize: number;
    action?: string;
    actorId?: string;
    entityType?: string;
    entityId?: string;
    severity?: string;
    from?: Date;
    to?: Date;
  }) {
    const where = {
      action: params.action,
      actorId: params.actorId,
      entityType: params.entityType,
      entityId: params.entityId,
      severity: params.severity,
      createdAt: params.from || params.to ? { gte: params.from, lte: params.to } : undefined,
    };

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { actor: { select: { id: true, username: true, email: true, roles: true } } },
      }),
    ]);

    return { total, page: params.page, pageSize: params.pageSize, rows };
  }
}

export const audit = new AuditService();
