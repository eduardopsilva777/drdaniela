import "server-only";

import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/** Contas da equipe (somente administração). Nunca devolve hashes de senha. */
export async function listStaff() {
  await requirePermission("users:manage");
  return getDb().user.findMany({
    // A conta de sistema do assistente virtual não é uma pessoa da equipe.
    where: { role: { not: "ASSISTANT" } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}
