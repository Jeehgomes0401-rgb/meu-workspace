/* =====================================================================
   Versão para venda: login, dados por empresa (Supabase), assinatura e
   painel do administrador. Este bloco substitui o "banco de dados" do app
   original e roda dentro do mesmo escopo.
   ===================================================================== */
const CFG=window.CONFIG||{};
const PRECO=+CFG.PRECO||60;
const configurado=CFG.SUPABASE_URL&&!/SEU-PROJETO/.test(CFG.SUPABASE_URL)&&CFG.SUPABASE_ANON_KEY&&!/COLE/.test(CFG.SUPABASE_ANON_KEY);
const SB=configurado&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
let EMPRESA=null, ADMIN=false, USER=null, canal=null, ultimoLoad=0;
document.querySelector(".head-ic").innerHTML=IC.gear;

/* ---------- adaptador: mesma interface que o app já usa ---------- */
const novoId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function makeDb(eid){
  const cache={}, subs={}, dsubs={};
  let pronto=false;
  const snapOf=c=>({docs:[...(cache[c]||new Map())].map(([id,d])=>({id,exists:true,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}})),size:(cache[c]||new Map()).size,metadata:{fromCache:false,hasPendingWrites:false}});
  const docSnap=(c,id)=>{const d=cache[c]&&cache[c].get(id);return{id,exists:!!d,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}}};
  const emit=c=>{if(!pronto)return;(subs[c]||[]).forEach(f=>f(snapOf(c)));Object.keys(dsubs).forEach(k=>{const[cc,id]=k.split("/");if(cc===c)dsubs[k].forEach(f=>f(docSnap(c,id)))})};
  const put=(c,id,d)=>{(cache[c]=cache[c]||new Map()).set(id,d)};
  const tira=(c,id)=>{if(cache[c])cache[c].delete(id)};
  const erro=e=>{const msg=(e&&e.message)||"";const bloq=(e&&e.code==="42501")||/row-level security/i.test(msg);return{code:bloq?"blocked":"unavailable",message:msg}};
  async function carregar(){
    const novo={};let de=0;
    for(;;){const{data,error}=await SB.from("registros").select("colecao,doc_id,dados").eq("empresa_id",eid).range(de,de+999);if(error)throw error;data.forEach(r=>{(novo[r.colecao]=novo[r.colecao]||new Map()).set(r.doc_id,r.dados)});if(data.length<1000)break;de+=1000}
    Object.keys(cache).forEach(k=>delete cache[k]);Object.assign(cache,novo);pronto=true;ultimoLoad=Date.now();
    new Set([...Object.keys(subs),...Object.keys(cache),...Object.keys(dsubs).map(k=>k.split("/")[0])]).forEach(emit);
  }
  async function gravar(c,id,d){const{error}=await SB.from("registros").upsert({empresa_id:eid,colecao:c,doc_id:id,dados:d});if(error)throw erro(error);put(c,id,d);emit(c)}
  async function apagar(c,id){const{data,error}=await SB.from("registros").delete().match({empresa_id:eid,colecao:c,doc_id:id}).select("doc_id");if(error)throw erro(error);if(!data||!data.length){if(cache[c]&&cache[c].has(id))throw{code:"blocked"}}tira(c,id);emit(c)}
  if(canal)SB.removeChannel(canal);
  canal=SB.channel("reg-"+eid)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"registros",filter:"empresa_id=eq."+eid},p=>{put(p.new.colecao,p.new.doc_id,p.new.dados);emit(p.new.colecao)})
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"registros",filter:"empresa_id=eq."+eid},p=>{put(p.new.colecao,p.new.doc_id,p.new.dados);emit(p.new.colecao)})
    .on("postgres_changes",{event:"DELETE",schema:"public",table:"registros"},p=>{const o=p.old||{};if(o.empresa_id!==eid)return;tira(o.colecao,o.doc_id);emit(o.colecao)})
    .subscribe();
  const api={
    carregar,
    collection(c){return{
      onSnapshot(f,err){(subs[c]=subs[c]||[]).push(f);if(pronto)setTimeout(()=>f(snapOf(c)),0);return()=>{subs[c]=(subs[c]||[]).filter(x=>x!==f)}},
      async add(d){const id=novoId();await gravar(c,id,d);return{id}},
      doc(id){id=id||novoId();return{id,set:d=>gravar(c,id,d),delete:()=>apagar(c,id)}}
    }},
    doc(path){const[c,id]=path.split("/");return{
      onSnapshot(f){const k=c+"/"+id;(dsubs[k]=dsubs[k]||[]).push(f);if(pronto)setTimeout(()=>f(docSnap(c,id)),0);return()=>{}},
      set:d=>gravar(c,id,d)
    }}
  };
  return api;
}

/* ---------- situação da assinatura ---------- */
function acesso(){
  if(!EMPRESA)return{ok:false};
  const h=todayIso(),pago=EMPRESA.pago_ate?addDays(EMPRESA.pago_ate,3)>=h:false,teste=EMPRESA.trial_ate>=h;
  if(EMPRESA.status==="bloqueada")return{ok:false,tipo:"bloqueada"};
  if(pago&&EMPRESA.pago_ate>=h)return{ok:true,tipo:"ativa",ate:EMPRESA.pago_ate};
  if(pago)return{ok:true,tipo:"tolerancia",ate:EMPRESA.pago_ate};
  if(teste)return{ok:true,tipo:"teste",ate:EMPRESA.trial_ate,dias:days(h,EMPRESA.trial_ate)};
  return{ok:false,tipo:"vencida",ate:EMPRESA.pago_ate||EMPRESA.trial_ate};
}
function bannerAcesso(){
  const a=acesso();
  if(a.tipo==="teste"&&EMPRESA.asaas_subscription_id)return '<div class="banner trial"><b>Teste grátis</b> até '+fd(a.ate)+'. Sua assinatura já está criada: a 1ª mensalidade vence no fim do teste. <button class="btn sm" data-act="assinatura">Ver fatura</button></div>';
  if(a.tipo==="teste")return '<div class="banner trial"><b>Teste grátis:</b> '+(a.dias===0?"termina hoje":a.dias===1?"falta 1 dia":"faltam "+a.dias+" dias")+'. Assine por '+brl(PRECO)+'/mês para continuar usando. <button class="btn sm pri" data-act="assinatura">Assinar agora</button></div>';
  if(a.tipo==="tolerancia")return '<div class="banner">Sua mensalidade venceu em '+fd(a.ate)+'. Pague nos próximos dias para não perder o acesso. <button class="btn sm pri" data-act="assinatura">Pagar agora</button></div>';
  if(a.tipo==="vencida")return '<div class="banner"><b>Seu acesso venceu em '+fd(a.ate)+'.</b> Seus dados continuam guardados e você pode consultá-los, mas para lançar e editar é preciso '+(EMPRESA.asaas_subscription_id?"pagar a mensalidade":"assinar")+'. <button class="btn sm pri" data-act="assinatura">'+(EMPRESA.asaas_subscription_id?"Pagar agora":"Assinar")+'</button></div>';
  if(a.tipo==="bloqueada")return '<div class="banner"><b>Acesso bloqueado.</b> Fale com o suporte para regularizar.</div>';
  return "";
}
async function recarregarEmpresa(){if(!EMPRESA)return;const{data}=await SB.from("empresas").select("*").eq("id",EMPRESA.id).single();if(data){EMPRESA=data;readOnly=!acesso().ok;render()}}

/* ---------- telas de entrada ---------- */
const AUTH=$("#auth");
function mostrarAuth(modo,msg){
  document.body.classList.add("sem-login");AUTH.hidden=false;
  const logo=document.querySelector("svg.brand-mark").outerHTML;
  const erroCfg=!configurado?'<div class="banner">O sistema ainda não foi configurado. Preencha o arquivo <b>config.js</b> com os dados do Supabase (veja o LEIA-ME).</div>':"";
  const forms={
    entrar:'<h2>Entrar</h2><form id="fa" data-modo="entrar">'+F("E-mail","email","","email",'autocomplete="email" required')+F("Senha","senha","","password",'autocomplete="current-password" required')+'<button class="btn pri big" type="submit">Entrar</button></form><div class="auth-links"><button class="lnk" data-act="auth" data-modo="esqueci">Esqueci minha senha</button><span>Ainda não tem conta? <button class="lnk" data-act="auth" data-modo="criar">Teste grátis por 7 dias</button></span></div>',
    criar:'<h2>Criar conta grátis</h2><p class="muted">7 dias grátis, sem cartão. Depois, '+brl(PRECO)+' por mês.</p><form id="fa" data-modo="criar">'+F("Nome da locadora","empresa","","text",'required autocomplete="organization"')+F("Seu nome","nome","","text",'required autocomplete="name"')+F("WhatsApp","telefone","","tel",'autocomplete="tel"')+F("E-mail","email","","email",'autocomplete="email" required')+F("Crie uma senha (mínimo 8 caracteres)","senha","","password",'autocomplete="new-password" minlength="8" required')+'<label class="f chk"><input type="checkbox" name="aceite" id="f-aceite"> Li e aceito os <a href="termos.html" target="_blank">Termos de Uso</a> e a <a href="privacidade.html" target="_blank">Política de Privacidade</a></label><button class="btn pri big" type="submit">Começar teste grátis</button></form><div class="auth-links"><span>Já tem conta? <button class="lnk" data-act="auth" data-modo="entrar">Entrar</button></span></div>',
    esqueci:'<h2>Recuperar senha</h2><p class="muted">Enviaremos um link para você criar uma nova senha.</p><form id="fa" data-modo="esqueci">'+F("E-mail","email","","email",'autocomplete="email" required')+'<button class="btn pri big" type="submit">Enviar link</button></form><div class="auth-links"><button class="lnk" data-act="auth" data-modo="entrar">Voltar para o login</button></div>',
    novasenha:'<h2>Nova senha</h2><form id="fa" data-modo="novasenha">'+F("Nova senha (mínimo 8 caracteres)","senha","","password",'autocomplete="new-password" minlength="8" required')+'<button class="btn pri big" type="submit">Salvar nova senha</button></form>',
    aviso:'<h2>Confira seu e-mail</h2><p>'+(msg||"")+'</p><div class="auth-links"><button class="lnk" data-act="auth" data-modo="entrar">Ir para o login</button></div>'
  };
  AUTH.innerHTML='<div class="auth-wrap"><section class="auth-pitch"><div class="auth-brand">'+logo+'<div><h1>Gestão da Locadora</h1><p>Sistema para locadoras de carros e motos</p></div></div><ul><li>Cadastro de veículos, motoristas e CNH</li><li>Locações semanais, quinzenais ou mensais com aviso de atraso</li><li>Cobrança no WhatsApp, recibos e contrato em PDF</li><li>Multas atreladas ao condutor e indicação em PDF</li><li>Fluxo de caixa com gráficos e planilha para o contador</li><li>Alerta de troca de óleo e revisão por km</li></ul><p class="preco"><b>'+brl(PRECO)+'</b>/mês · 7 dias grátis</p></section><section class="auth-card">'+erroCfg+(modo!=="aviso"&&msg?'<div class="banner">'+esc(msg)+'</div>':"")+forms[modo]+'</section></div>';
}
function esconderAuth(){AUTH.hidden=true;AUTH.innerHTML="";document.body.classList.remove("sem-login")}
const traduz=m=>/Invalid login/i.test(m)?"E-mail ou senha incorretos.":/Email not confirmed/i.test(m)?"Confirme seu e-mail pelo link que enviamos antes de entrar.":/already registered|already been registered/i.test(m)?"Já existe uma conta com este e-mail. Entre ou recupere a senha.":/Password should be/i.test(m)?"A senha precisa ter pelo menos 8 caracteres.":/rate limit|too many/i.test(m)?"Muitas tentativas. Aguarde alguns minutos.":/valid email|invalid format/i.test(m)?"Informe um e-mail válido.":"Não foi possível concluir. Tente de novo.";
AUTH.addEventListener("submit",async e=>{
  e.preventDefault();e.stopPropagation();if(!SB)return;
  const f=e.target,modo=f.dataset.modo,o=Object.fromEntries(new FormData(f)),btn=f.querySelector("button[type=submit]");btn.disabled=true;
  try{
    if(modo==="entrar"){const{error}=await SB.auth.signInWithPassword({email:o.email.trim(),password:o.senha});if(error)throw error}
    if(modo==="criar"){if(!$("#f-aceite").checked){btn.disabled=false;return toast("Para criar a conta, aceite os Termos e a Política de Privacidade.")}
      const{data,error}=await SB.auth.signUp({email:o.email.trim(),password:o.senha,options:{emailRedirectTo:location.origin+location.pathname,data:{empresa:o.empresa,nome:o.nome,telefone:o.telefone}}});if(error)throw error;
      if(!data.session)return mostrarAuth("aviso","Enviamos um link de confirmação para <b>"+esc(o.email)+"</b>. Abra o e-mail e toque no link para ativar sua conta.")}
    if(modo==="esqueci"){const{error}=await SB.auth.resetPasswordForEmail(o.email.trim(),{redirectTo:location.origin+location.pathname});if(error)throw error;return mostrarAuth("aviso","Se existir uma conta com <b>"+esc(o.email)+"</b>, você vai receber um link para criar uma nova senha.")}
    if(modo==="novasenha"){const{error}=await SB.auth.updateUser({password:o.senha});if(error)throw error;toast("Senha alterada");esconderAuth();iniciarSessao((await SB.auth.getSession()).data.session,true)}
  }catch(err){btn.disabled=false;mostrarAuth(modo,traduz(err.message||""))}
},true);

/* ---------- sessão ---------- */
let recuperando=false;
async function iniciarSessao(session,forcar){
  if(recuperando)return;
  if(!session){USER=null;EMPRESA=null;db=null;mostrarAuth("entrar");return}
  if(!forcar&&USER&&USER.id===session.user.id&&EMPRESA)return;
  USER=session.user;
  try{
    const{data:m,error}=await SB.from("membros").select("empresa_id").eq("user_id",USER.id).limit(1);if(error)throw error;
    if(!m||!m.length){mostrarAuth("entrar","Sua conta ainda não está ligada a uma locadora. Fale com o suporte.");return}
    const{data:emp}=await SB.from("empresas").select("*").eq("id",m[0].empresa_id).single();EMPRESA=emp;
    const{data:adm}=await SB.from("admins").select("user_id").eq("user_id",USER.id);ADMIN=!!(adm&&adm.length);
    esconderAuth();
    COLS.forEach(c=>S[c]=[]);EMP={};
    db=makeDb(EMPRESA.id);readOnly=!acesso().ok;dbState="loading";render();
    db.doc("config/empresa").onSnapshot(d=>{EMP=d.exists?Object.assign({},d.data()):{};render()});
    COLS.forEach(c=>db.collection(c).onSnapshot(snap=>{S[c]=snap.docs.map(x=>Object.assign({id:x.id},x.data()));render()}));
    await db.carregar();dbState="ok";
    if(!EMP.nome&&EMPRESA.nome)EMP={nome:EMPRESA.nome,telefone:EMPRESA.telefone||"",responsavel:EMPRESA.responsavel||""};
    render();
  }catch(e){dbState="error";render()}
}
if(SB){
  SB.auth.onAuthStateChange((ev,session)=>{
    if(ev==="PASSWORD_RECOVERY"){recuperando=true;setTimeout(()=>{recuperando=false;mostrarAuth("novasenha")},0);return}
    if(ev==="SIGNED_OUT"){setTimeout(()=>iniciarSessao(null),0);return}
    setTimeout(()=>iniciarSessao(session),0);
  });
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&db&&Date.now()-ultimoLoad>60000){db.carregar().catch(()=>{});recarregarEmpresa()}});
}else mostrarAuth("entrar");

/* ---------- menu, assinatura e administrador ---------- */
function abrirFolha(titulo,html){
  $("#sheet-root").innerHTML='<div class="sheet-bg" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-h"><h2 id="sheet-title">'+esc(titulo)+'</h2><button class="icon-btn" data-act="close" aria-label="Fechar">'+IC.close+'</button></div>'+html+'</div></div>';
  sheet={kind:"info"};document.body.style.overflow="hidden";
}
function abrirMenu(){
  const a=acesso();
  abrirFolha("Menu",'<div class="menu">'+
    '<button class="menu-i" data-act="empresa"><b>Dados da locadora</b><span>Nome, CNPJ, Pix e dados dos documentos</span></button>'+
    '<button class="menu-i" data-act="assinatura"><b>Minha assinatura</b><span>'+({teste:"Teste grátis até "+fd(a.ate),ativa:"Ativa até "+fd(a.ate),tolerancia:"Vencida em "+fd(a.ate),vencida:"Vencida em "+fd(a.ate),bloqueada:"Bloqueada"}[a.tipo]||"")+'</span></button>'+
    (ADMIN?'<button class="menu-i" data-act="ver-clientes"><b>Painel de clientes</b><span>Quem assina, quem está em teste e quem está atrasado</span></button>':"")+
    '<a class="menu-i" href="termos.html" target="_blank"><b>Termos de uso e privacidade</b><span>Regras do serviço e tratamento de dados</span></a>'+
    (CFG.WHATS_SUPORTE?'<a class="menu-i" href="https://wa.me/'+esc(foneWa(CFG.WHATS_SUPORTE))+'" target="_blank"><b>Falar com o suporte</b><span>WhatsApp</span></a>':"")+
    '<button class="menu-i" data-act="sair"><b>Sair</b><span>'+esc(USER?USER.email:"")+'</span></button></div>');
}
async function abrirAssinatura(){
  await recarregarEmpresa();const a=acesso(),tem=!!EMPRESA.asaas_subscription_id;
  const{data:pg}=await SB.from("pagamentos").select("*").eq("empresa_id",EMPRESA.id).order("vencimento",{ascending:false}).limit(12);
  const st={teste:["Teste grátis","warn","até "+fd(a.ate)],ativa:["Ativa","ok","paga até "+fd(a.ate)],tolerancia:["Vencida","bad","desde "+fd(a.ate)],vencida:["Vencida","bad","desde "+fd(a.ate)],bloqueada:["Bloqueada","bad",""]}[a.tipo]||["—","",""];
  abrirFolha("Minha assinatura",
    '<div class="card"><div class="row"><div class="grow"><div class="t">Plano mensal</div><div class="sub">'+brl(PRECO)+' por mês · Pix, boleto ou cartão</div></div><span class="chip '+st[1]+'">'+st[0]+'</span></div><div class="sub">'+esc(st[2])+'</div></div>'+
    (tem?'<div class="actions" style="margin-top:14px"><button class="btn pri" data-act="fatura">Ver fatura em aberto</button><button class="btn" data-act="atualiza-assin">Já paguei, atualizar</button></div>'
       :'<form id="fassin" style="margin-top:14px"><div class="note">Para emitir a cobrança, informe o CPF ou CNPJ de quem vai pagar. '+(a.tipo==="teste"?"A primeira mensalidade vence no fim do teste grátis.":"")+'</div><div class="grid">'+F("Nome de quem paga","nome",EMP.nome||EMPRESA.nome,"text",'class="full"')+F("CPF ou CNPJ","cpfCnpj",EMP.documento||"","text",'inputmode="numeric" required')+F("WhatsApp","telefone",EMP.telefone||EMPRESA.telefone||"","tel")+'</div><button class="btn pri" type="submit" style="margin-top:12px">Assinar por '+brl(PRECO)+'/mês</button></form>')+
    '<div id="fatura-box"></div>'+
    (pg&&pg.length?'<h3 style="margin:18px 0 8px;font-size:15px">Pagamentos</h3><div class="panel tbl-wrap"><table><thead><tr><th>Vencimento</th><th class="r">Valor</th><th>Situação</th></tr></thead><tbody>'+pg.map(p=>'<tr><td>'+fd(p.vencimento)+'</td><td class="r num">'+brl(p.valor)+'</td><td>'+esc({RECEIVED:"Pago",CONFIRMED:"Pago",PENDING:"Aguardando",OVERDUE:"Vencido",REFUNDED:"Estornado"}[p.status]||p.status)+'</td></tr>').join("")+'</tbody></table></div>':""));
}
async function pedirFatura(body){
  const box=$("#fatura-box");if(box)box.innerHTML='<p class="muted" style="margin-top:12px">Gerando cobrança…</p>';
  const{data,error}=await SB.functions.invoke("assinar",{body:body||{}});
  let msg=data&&data.erro;if(error&&!msg){try{msg=(await error.context.json()).erro}catch(_){msg="Não foi possível gerar a cobrança agora."}}
  if(msg){if(box)box.innerHTML='<div class="banner" style="margin-top:12px">'+esc(msg)+'</div>';return}
  await recarregarEmpresa();
  if(box)box.innerHTML=data.url?'<div class="card" style="margin-top:12px"><div class="t">Fatura de '+brl(data.valor||PRECO)+(data.vencimento?' · vence '+fd(data.vencimento):"")+'</div><div class="sub">Abra a fatura para pagar com Pix, boleto ou cartão. Assim que o pagamento for confirmado, o acesso é liberado sozinho.</div><a class="btn pri" href="'+esc(data.url)+'" target="_blank" rel="noopener">Abrir fatura e pagar</a></div>':'<div class="note" style="margin-top:12px">'+esc(data.mensagem||"Nenhuma fatura em aberto.")+'</div>';
}
document.addEventListener("submit",e=>{if(e.target.id==="fassin"){e.preventDefault();e.stopImmediatePropagation();const o=Object.fromEntries(new FormData(e.target));if(![11,14].includes(digits(o.cpfCnpj).length))return toast("Informe um CPF (11 números) ou CNPJ (14 números).");e.target.querySelector("button").disabled=true;pedirFatura(o)}},true);

let ADM={lista:[],filtro:"todos"};
async function carregarClientes(){const{data}=await SB.from("empresas").select("*").order("criado_em",{ascending:false});ADM.lista=data||[];render()}
function situacao(e){const h=todayIso();if(e.status==="bloqueada")return["Bloqueada","bad"];if(e.pago_ate&&e.pago_ate>=h)return["Pagante","ok"];if(e.pago_ate&&addDays(e.pago_ate,3)>=h)return["Venceu ("+fd(e.pago_ate)+")","warn"];if(e.trial_ate>=h)return["Teste até "+fd(e.trial_ate),"warn"];return["Inativa","bad"]}
function vClientesAdmin(){
  const l=ADM.lista,h=todayIso();
  const pag=l.filter(e=>e.pago_ate&&addDays(e.pago_ate,3)>=h&&e.status!=="bloqueada"),tes=l.filter(e=>!(e.pago_ate&&addDays(e.pago_ate,3)>=h)&&e.trial_ate>=h);
  const filt=ADM.filtro==="pagantes"?pag:ADM.filtro==="teste"?tes:ADM.filtro==="inativos"?l.filter(e=>!pag.includes(e)&&!tes.includes(e)):l;
  return '<section class="sec"><div class="sec-h"><h2>Painel de clientes</h2><button class="btn sm" data-act="ver-clientes">Atualizar</button></div>'+
  '<div class="kpis k4"><div class="kpi"><span class="eyebrow">Contas</span><b class="num">'+l.length+'</b></div><div class="kpi"><span class="eyebrow">Pagantes</span><b class="num">'+pag.length+'</b></div><div class="kpi"><span class="eyebrow">Em teste</span><b class="num">'+tes.length+'</b></div><div class="kpi"><span class="eyebrow">Receita mensal</span><b class="num">'+brl(pag.length*PRECO)+'</b></div></div>'+
  '<div class="seg" role="radiogroup">'+[["todos","Todos"],["pagantes","Pagantes"],["teste","Em teste"],["inativos","Inativos"]].map(([k,t])=>'<label><input type="radio" name="admf" value="'+k+'" data-act="admf"'+(ADM.filtro===k?" checked":"")+'><span>'+t+'</span></label>').join("")+'</div></section>'+
  '<section class="sec"><div class="list">'+(filt.length?filt.map(e=>{const s=situacao(e);return '<article class="card"><div class="row"><div class="grow"><div class="t">'+esc(e.nome)+'</div><div class="sub ellip">'+esc([e.responsavel,e.email].filter(Boolean).join(" · "))+'</div></div><span class="chip '+s[1]+'">'+esc(s[0])+'</span></div><div class="sub">Conta criada em '+fd((e.criado_em||"").slice(0,10))+(e.asaas_subscription_id?" · assinatura no Asaas":" · sem assinatura")+'</div><div class="actions">'+(e.telefone?'<a class="btn sm wa" href="https://wa.me/'+esc(foneWa(e.telefone))+'" target="_blank" rel="noopener">'+IC.wa+'WhatsApp</a>':"")+'<button class="btn sm" data-act="adm-30" data-id="'+e.id+'">Liberar +30 dias</button><button class="btn sm '+(e.status==="bloqueada"?"":"danger")+'" data-act="adm-bloq" data-id="'+e.id+'">'+(e.status==="bloqueada"?"Desbloquear":"Bloquear")+'</button></div></article>'}).join(""):'<div class="empty">Nenhuma conta neste filtro.</div>')+'</div></section>';
}
VIEWS.adm=vClientesAdmin;
async function admAltera(id,patch,ok){const{error}=await SB.from("empresas").update(patch).eq("id",id);if(error)return toast("Não foi possível alterar.");toast(ok);carregarClientes()}

document.addEventListener("click",e=>{
  const a=e.target.closest("[data-act]");if(!a)return;const act=a.dataset.act,id=a.dataset.id;
  const tratar={
    menu:()=>abrirMenu(),
    assinatura:()=>abrirAssinatura(),
    fatura:()=>pedirFatura(),
    "atualiza-assin":async()=>{await recarregarEmpresa();toast(acesso().tipo==="ativa"?"Pagamento confirmado. Obrigado!":"Ainda não recebemos a confirmação. Pix confirma em minutos; boleto pode levar até 3 dias úteis.");abrirAssinatura()},
    sair:async()=>{closeSheet();await SB.auth.signOut()},
    auth:()=>mostrarAuth(a.dataset.modo),
    "ver-clientes":()=>{closeSheet();view="adm";carregarClientes();render();window.scrollTo(0,0)},
    "adm-30":()=>{const x=ADM.lista.find(z=>z.id===id);const base=x.pago_ate&&x.pago_ate>todayIso()?x.pago_ate:todayIso();admAltera(id,{pago_ate:addDays(base,30),status:"ativa"},"Acesso liberado por mais 30 dias")},
    "adm-bloq":()=>{const x=ADM.lista.find(z=>z.id===id);admAltera(id,{status:x.status==="bloqueada"?"ativa":"bloqueada"},x.status==="bloqueada"?"Conta desbloqueada":"Conta bloqueada")}
  };
  if(tratar[act]){e.preventDefault();e.stopImmediatePropagation();if(act==="assinatura"||act==="empresa")closeSheet();tratar[act]()}
},true);
document.addEventListener("change",e=>{if(e.target.dataset.act==="admf"){ADM.filtro=e.target.value;render()}});
