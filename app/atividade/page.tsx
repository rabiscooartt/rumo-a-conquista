import { cookies } from "next/headers";
import AtividadeClient from "@/app/atividade/AtividadeClient";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

export default async function AtividadePage() {
  const store = await cookies();
  const adminSession = await verifyAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);

  return <AtividadeClient adminSession={adminSession} />;
}
