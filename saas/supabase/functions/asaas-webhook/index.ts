// Função "asaas-webhook": o Asaas avisa aqui quando um pagamento é confirmado,
// vence ou é estornado. Libera ou marca o acesso da locadora automaticamente.
//
// IMPORTANTE: ao criar esta função no Supabase, DESLIGUE a opção "Verify JWT"
// (o Asaas não envia login do Supabase; a proteção é o token abaixo).
//
// Segredo necessário (Supabase > Edge Functions > Secrets):
//   ASAAS_WEBHOOK_TOKEN  o mesmo "Token de autenticação" cadastrado no webhook do Asaas
import { createClient } from "jsr:@supabase/supabase-js@2";

const addMes = (d: string) => {
  const [y, m, dia] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 1));                       // primeiro dia do mês seguinte
  const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();      // último dia do mês seguinte
  dt.setUTCDate(Math.min(dia, ult));
  return dt.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const token = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (!token || req.headers.get("asaas-access-token") !== token) {
    return new Response("não autorizado", { status: 401 });
  }

  const ev = await req.json().catch(() => null);
  const p = ev?.payment;
  if (!p) return new Response("ok");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Descobre a empresa pela referência ou pela assinatura.
  let empresaId: string | null = null;
  if (p.externalReference) {
    const { data } = await db.from("empresas").select("id").eq("id", p.externalReference).maybeSingle();
    empresaId = data?.id ?? null;
  }
  if (!empresaId && p.subscription) {
    const { data } = await db.from("empresas").select("id").eq("asaas_subscription_id", p.subscription).maybeSingle();
    empresaId = data?.id ?? null;
  }

  await db.from("pagamentos").upsert({
    asaas_payment_id: p.id, empresa_id: empresaId, valor: p.value, vencimento: p.dueDate,
    status: p.status, forma: p.billingType, fatura_url: p.invoiceUrl, atualizado_em: new Date().toISOString(),
  });
  if (!empresaId) return new Response("ok");

  const { data: emp } = await db.from("empresas").select("pago_ate").eq("id", empresaId).single();

  if (ev.event === "PAYMENT_CONFIRMED" || ev.event === "PAYMENT_RECEIVED") {
    // Cada pagamento libera 1 mês a partir do vencimento dele. Repetir o aviso não soma de novo.
    const novo = addMes(p.dueDate);
    const pagoAte = emp?.pago_ate && emp.pago_ate > novo ? emp.pago_ate : novo;
    await db.from("empresas").update({ pago_ate: pagoAte, status: "ativa" }).eq("id", empresaId);
  } else if (ev.event === "PAYMENT_OVERDUE") {
    await db.from("empresas").update({ status: "atrasada" }).eq("id", empresaId);
  } else if (ev.event === "PAYMENT_REFUNDED" || ev.event === "PAYMENT_CHARGEBACK_REQUESTED") {
    await db.from("empresas").update({ status: "atrasada", pago_ate: p.dueDate }).eq("id", empresaId);
  } else if (ev.event === "SUBSCRIPTION_DELETED" || ev.event === "SUBSCRIPTION_INACTIVATED") {
    await db.from("empresas").update({ status: "cancelada" }).eq("id", empresaId);
  }
  return new Response("ok");
});
