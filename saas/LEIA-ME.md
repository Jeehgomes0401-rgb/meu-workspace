# Gestão da Locadora — como colocar no ar para vender

Este guia leva você do zero até o sistema funcionando com login, teste grátis de 7 dias e cobrança automática de **R$ 60/mês**. Siga na ordem. Tempo estimado: **1 a 2 horas** na primeira vez.

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `public/` | O site (é isso que vai para a internet) |
| `public/config.js` | Onde você cola os dados do seu Supabase |
| `public/termos.html` e `public/privacidade.html` | Rascunhos dos Termos de Uso e da Política de Privacidade |
| `supabase/schema.sql` | Cria o banco de dados e as regras de segurança |
| `supabase/functions/assinar/` | Cria a assinatura no Asaas e gera a fatura |
| `supabase/functions/asaas-webhook/` | Recebe o aviso de pagamento do Asaas e libera o acesso |
| `build.py` | Gera `public/index.html` a partir do app da pasta `locadora/` |

---

## Passo 1 — Supabase (banco de dados e login)

1. Crie uma conta em **supabase.com** e clique em **New project**.
   - **Region:** escolha **South America (São Paulo)** — os dados ficam no Brasil e o app fica mais rápido.
   - Anote a **senha do banco** num lugar seguro.
2. Quando o projeto terminar de criar, abra **SQL Editor → New query**.
3. Abra o arquivo `supabase/schema.sql`, copie **tudo**, cole no editor e clique em **Run**. Deve aparecer "Success".
4. Vá em **Project Settings → API Keys** e anote:
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - a chave **anon public** (aba *Legacy API keys*). Ela é pública; pode ir no site.
   - **Nunca** coloque a chave `service_role` no site.

### 1.1 Login por e-mail
Em **Authentication → Sign In / Providers → Email**:
- Deixe **Enable Email provider** ligado.
- Deixe **Confirm email** ligado (o cliente confirma o e-mail antes de entrar).
- **Minimum password length:** 8.

### 1.2 Envio de e-mails (importante)
O Supabase envia poucos e-mails por hora no plano grátis — só serve para testes. Antes de vender, configure um provedor de e-mail:
- Crie uma conta grátis na **Brevo** (300 e-mails/dia) ou **Resend**.
- Em **Authentication → Emails → SMTP Settings**, ative **Custom SMTP** e cole os dados que o provedor fornece.
- Em **Authentication → Emails → Templates**, troque os textos para português (modelos no fim deste guia).

---

## Passo 2 — Asaas (cobrança)

Comece pelo **ambiente de testes** para não mexer com dinheiro de verdade.

1. Crie uma conta em **sandbox.asaas.com** (testes). Depois, para valer, crie a conta normal em **asaas.com**.
2. Em **Integrações → Chaves de API**, gere uma chave e copie (começa com `$aact_`).
3. Invente uma senha longa para proteger o webhook (ex.: 30 letras e números aleatórios). Vamos chamá-la de **TOKEN DO WEBHOOK**.

---

## Passo 3 — Funções no Supabase (pagamentos)

No Supabase, abra **Edge Functions**.

1. **Secrets** (ou *Manage secrets*) → adicione:

   | Nome | Valor |
   |---|---|
   | `ASAAS_API_KEY` | a chave de API do Asaas |
   | `ASAAS_AMBIENTE` | `sandbox` (troque para `producao` quando for valer) |
   | `ASAAS_WEBHOOK_TOKEN` | o TOKEN DO WEBHOOK que você inventou |
   | `PLANO_VALOR` | `60` |

2. **Deploy a new function → Via Editor**
   - Nome: `assinar`
   - Apague o código de exemplo, cole o conteúdo de `supabase/functions/assinar/index.ts` e clique em **Deploy**.
3. Repita para a segunda função:
   - Nome: `asaas-webhook`
   - Cole `supabase/functions/asaas-webhook/index.ts` e faça o **Deploy**.
   - Abra a função → **Details/Settings** → **desligue "Enforce JWT verification"** e salve. (O Asaas não tem login no Supabase; a proteção é o token.)
4. Copie o endereço da função `asaas-webhook`. Fica assim:
   `https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook`

### 3.1 Webhook no Asaas
No Asaas: **Integrações → Webhooks → Adicionar**:
- **URL:** o endereço da função `asaas-webhook`
- **Token de autenticação:** o TOKEN DO WEBHOOK
- **Versão da API:** v3 · **Fila de sincronização:** ativada
- **Eventos:** marque *Cobrança confirmada*, *Cobrança recebida*, *Cobrança vencida*, *Cobrança estornada* e *Assinatura removida/inativada*.

---

## Passo 4 — Configurar o site

Abra `public/config.js` e preencha:

```js
SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
SUPABASE_ANON_KEY: "a chave anon public",
PRECO: 60,
WHATS_SUPORTE: "11999999999"
```

Se preferir, me mande a **Project URL** e a **chave anon** que eu preencho e envio para o GitHub. (Nunca mande a `service_role` nem a chave do Asaas.)

---

## Passo 5 — Netlify (colocar o site no ar)

1. Crie uma conta em **netlify.com** (pode entrar com o GitHub).
2. **Add new site → Import an existing project → GitHub** → escolha o repositório `meu-workspace`.
3. **Branch to deploy:** a branch onde está o sistema (hoje: `claude/dazzling-bell-cckt2e`; depois de juntar na principal, use `main`).
4. As demais configurações já vêm do arquivo `netlify.toml`. Clique em **Deploy**.
5. Você recebe um endereço tipo `https://nome-aleatorio.netlify.app`. Em **Site configuration → Change site name** dá para trocar o nome.

A partir daí, **toda atualização que eu enviar ao GitHub entra no ar sozinha**.

### 5.1 Avisar o Supabase do endereço do site
Supabase → **Authentication → URL Configuration**:
- **Site URL:** o endereço do seu site (ex.: `https://gestaolocadora.netlify.app`)
- **Redirect URLs:** adicione o mesmo endereço.

Sem isso, os links de confirmação de e-mail e de "esqueci a senha" não funcionam.

### 5.2 Domínio próprio (opcional)
Compre o domínio no **registro.br** (~R$ 40/ano). Na Netlify: **Domain management → Add a domain** e siga as instruções de DNS. Depois atualize o Site URL do passo 5.1.

---

## Passo 6 — Virar administrador

1. Abra o site e **crie a sua conta** (como se fosse um cliente). Confirme o e-mail.
2. No Supabase, **SQL Editor**, rode trocando o e-mail:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'seu-email@exemplo.com'
on conflict do nothing;
```

3. Entre de novo no site. No **menu (engrenagem) → Painel de clientes** você vê todas as contas, quem paga, quem está em teste, a receita do mês, e pode **liberar +30 dias** (ex.: pagamento por fora) ou **bloquear** uma conta.

---

## Passo 7 — Testar antes de vender

1. Crie uma conta de teste com outro e-mail.
2. No app: **menu → Minha assinatura**, informe um CPF válido e gere a fatura.
3. No **sandbox do Asaas**, abra a cobrança e use **Confirmar recebimento** para simular o pagamento.
4. Volte ao app → **Já paguei, atualizar**: deve aparecer **Ativa**.
5. Confira se uma conta não enxerga os dados da outra.

### Quando estiver tudo certo
- Troque `ASAAS_AMBIENTE` para `producao` e `ASAAS_API_KEY` pela chave da conta **real** do Asaas.
- Cadastre o webhook (passo 3.1) também na conta real.
- Preencha os campos entre `[colchetes]` em `termos.html` e `privacidade.html` e **peça para um advogado revisar**.

---

## Como funciona a cobrança

- Conta nova: **7 dias grátis**, sem cartão.
- O cliente assina dentro do app. A 1ª mensalidade vence no fim do teste e as próximas, todo mês.
- Na fatura do Asaas ele escolhe **Pix, boleto ou cartão**.
- Pagou → o Asaas avisa → o acesso é liberado por mais 1 mês, automaticamente.
- Atrasou → **3 dias de tolerância**. Depois disso o cliente continua **vendo** os dados, mas não consegue lançar nem editar até pagar.

## Custos aproximados

| Serviço | Custo |
|---|---|
| Supabase | Grátis no começo; US$ 25/mês quando crescer (o grátis pausa projetos sem uso por 1 semana) |
| Netlify | Grátis (uso comercial permitido) |
| Brevo (e-mails) | Grátis até 300 e-mails/dia |
| Asaas | Sem mensalidade; taxa por cobrança recebida |
| Domínio | ~R$ 40/ano |

> Antes de ter clientes pagantes, migre o Supabase para o plano Pro: no grátis o projeto é pausado após 7 dias sem uso e não tem backup diário.

## Atualizar o sistema

O app de venda é gerado a partir do app em `locadora/index.html`. Depois de qualquer mudança:

```bash
python3 saas/build.py
```

e envie para o GitHub — a Netlify publica sozinha. (Pode pedir para mim.)

---

## Modelos de e-mail em português (Supabase → Authentication → Emails → Templates)

**Confirm signup** — Assunto: `Confirme seu cadastro na Gestão da Locadora`
```html
<h2>Bem-vindo(a) à Gestão da Locadora!</h2>
<p>Toque no botão abaixo para confirmar seu e-mail e começar o teste grátis de 7 dias.</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p>
<p>Se você não criou esta conta, ignore este e-mail.</p>
```

**Reset password** — Assunto: `Crie uma nova senha`
```html
<h2>Recuperação de senha</h2>
<p>Recebemos um pedido para trocar a senha da sua conta. Toque no botão para criar uma nova:</p>
<p><a href="{{ .ConfirmationURL }}">Criar nova senha</a></p>
<p>Se não foi você, ignore este e-mail. Sua senha continua a mesma.</p>
```
