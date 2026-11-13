// Função "assinar": cria (ou recupera) a assinatura de R$ 60/mês no Asaas
// e devolve o link da fatura para o cliente pagar por Pix, boleto ou cartão.
//
// Segredos necessários (Supabase > Edge Functions > Secrets):
//   ASAAS_API_KEY   chave de API da sua conta Asaas
//   ASAAS_AMBIENTE  "producao" ou "sandbox" (padrão: sandbox, para testes)
//   PLANO_VALOR     opcional, padrão 60
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ASAAS = (Deno.env.get("ASAAS_AMBIENTE") || "sandbox") === "producao"
  ? "https://api.asaas.com/v3"
  : "https://api-sandbox.asaas.com/v3";
const VALOR = Number(Deno.env.get("PLANO_VALOR") || 60);

async function asaas(path: string, init: RequestInit = {}) {
  const r = await fetch(ASAAS + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "gestao-locadora",
      access_token: Deno.env.get("ASAAS_API_KEY") || "",
      ...(init.headers || {}),
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.errors?.[0]?.description || "Erro ao falar com o Asaas";
    throw new Error(msg);
  }
  return body;
}

const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ erro: "Faça login novamente." }, 401);

    const { data: m } = await admin.from("membros").select("empresa_id").eq("user_id", u.user.id).limit(1).single();
    if (!m) return json({ erro: "Empresa não encontrada." }, 404);
    const { data: emp } = await admin.from("empresas").select("*").eq("id", m.empresa_id).single();

    const entrada = await req.json().catch(() => ({}));

    // Já tem assinatura: devolve a fatura em aberto (ou a última).
    if (emp.asaas_subscription_id) {
      const pend = await asaas(`/payments?subscription=${emp.asaas_subscription_id}&status=PENDING&limit=1`);
      const atr = await asaas(`/payments?subscription=${emp.asaas_subscription_id}&status=OVERDUE&limit=1`);
      const p = atr.data?.[0] || pend.data?.[0];
      if (p) return json({ url: p.invoiceUrl, vencimento: p.dueDate, valor: p.value });
      return json({ url: null, mensagem: "Nenhuma fatura em aberto. Sua assinatura está em dia." });
    }

    // Primeira assinatura: precisa de CPF ou CNPJ (exigência do Asaas).
    const doc = String(entrada.cpfCnpj || "").replace(/\D/g, "");
    if (doc.length !== 11 && doc.length !== 14) return json({ erro: "Informe um CPF ou CNPJ válido." }, 400);
    const nome = String(entrada.nome || emp.nome || "").trim() || emp.nome;

    let customerId = emp.asaas_customer_id;
    if (!customerId) {
      const c = await asaas("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: nome, cpfCnpj: doc, email: emp.email,
          mobilePhone: (entrada.telefone || emp.telefone || "").replace(/\D/g, "") || undefined,
          externalReference: emp.id, notificationDisabled: false,
        }),
      });
      customerId = c.id;
    }

    // Se ainda está no teste grátis, a 1ª cobrança vence no fim do teste.
    const venc = emp.trial_ate && emp.trial_ate > hoje() ? emp.trial_ate : hoje();
    const s = await asaas("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED", // o cliente escolhe Pix, boleto ou cartão na fatura
        value: VALOR,
        nextDueDate: venc,
        cycle: "MONTHLY",
        description: "Gestão da Locadora - assinatura mensal",
        externalReference: emp.id,
      }),
    });

    await admin.from("empresas").update({
      asaas_customer_id: customerId, asaas_subscription_id: s.id,
    }).eq("id", emp.id);

    const pays = await asaas(`/payments?subscription=${s.id}&limit=1`);
    const p = pays.data?.[0];
    return json({ url: p?.invoiceUrl || null, vencimento: p?.dueDate || venc, valor: VALOR });
  } catch (e) {
    return json({ erro: (e as Error).message || "Erro inesperado." }, 500);
  }
});
