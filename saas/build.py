#!/usr/bin/env python3
"""Gera saas/public/index.html (versão para venda) a partir de locadora/index.html.
Uso: python3 saas/build.py   (na pasta do repositório)"""
import pathlib, re, sys
raiz = pathlib.Path(__file__).resolve().parent
src = (raiz.parent / "locadora" / "index.html").read_text(encoding="utf-8")
boot = (raiz / "src" / "boot.js").read_text(encoding="utf-8")
css = (raiz / "src" / "extra.css").read_text(encoding="utf-8")

def troca(texto, velho, novo, nome):
    if velho not in texto:
        sys.exit(f"Trecho não encontrado: {nome}")
    return texto.replace(velho, novo, 1)

s = src
# título e meta próprios ficam no <head>
titulo = re.search(r"<title>.*?</title>\n", s).group(0)
s = s.replace(titulo, "", 1).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "", 1)
s = troca(s, "\n</style>", "\n" + css + "</style>", "css")
# banco de dados -> Supabase
i = s.index("/* ---------- banco de dados ---------- */")
j = s.rindex("})();\n</script>")
s = s[:i] + boot + "\n" + s[j:]
# textos e comportamentos ligados ao claude.ai
s = troca(s, 'toast("Os dados só podem ser salvos com o app aberto pelo claude.ai.")', 'toast("Entre na sua conta para salvar.")', "save")
s = troca(s, """if(dbState==="none")pre='<div class="banner"><b>Os dados não estão sendo salvos.</b> Abra este app pelo claude.ai com a sua conta para cadastrar e guardar veículos, clientes e lançamentos.</div>';""",
             """pre=typeof bannerAcesso==="function"?bannerAcesso():"";if(dbState==="none")pre+='';""", "banner")
s = troca(s, """  if(readOnly)pre+='<div class="banner">Você tem acesso só para visualizar. Peça ao dono do app acesso de editor para lançar dados.</div>';\n""", "", "readonly")
s = troca(s, 'pre="";\n  if(dbState', 'pre="";\n  if(dbState', "pre-init") if 'pre="";\n  if(dbState' in s else s
s = troca(s, 'function dbErr(e){const c=e&&e.code;', 'function dbErr(e){const c=e&&e.code;if(c==="blocked"){readOnly=true;render();toast("Seu acesso venceu. Renove a assinatura para lançar e editar.");return}', "dbErr")
s = re.sub(r"let dl=null;\nasync function salvarArquivo\(nome,data\)\{.*?\n\}\n",
           """async function salvarArquivo(nome,data){
  try{const b=data instanceof Blob?data:new Blob([data]);const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);toast("Arquivo pronto")}catch(e){toast("Não foi possível baixar o arquivo.")}
}
""", s, count=1, flags=re.S)
if "dl.save" in s: sys.exit("salvarArquivo não substituído")
s = troca(s, 'data-act="empresa" aria-label="Dados da locadora" title="Dados da locadora"', 'data-act="menu" aria-label="Menu" title="Menu"', "menu")
s = troca(s, '$("#sync").textContent=dbState==="ok"?"Dados salvos na nuvem":dbState==="none"?"Modo de visualização":"Conectando…";',
             '$("#sync").textContent=dbState==="ok"?(typeof EMPRESA!=="undefined"&&EMPRESA?EMPRESA.nome:"Dados salvos na nuvem"):dbState==="error"?"Sem conexão":"Carregando…";', "sync")
s = troca(s, 'try{const v=localStorage.getItem("loc_view");if(v)view=v}catch(e){}', 'try{const v=localStorage.getItem("loc_view");if(v&&v!=="adm")view=v}catch(e){}', "view")

head = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
""" + titulo + """<meta name="description" content="Sistema para locadoras de carros e motos: veículos, motoristas, locações, multas e fluxo de caixa.">
<meta name="theme-color" content="#2B2D33">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Locadora">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icone-192.png" type="image/png">
<link rel="apple-touch-icon" href="icone-180.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<script src="config.js"></script>
</head>
<body>
<div id="auth" hidden></div>
"""
s = head + s.lstrip() + "\n</body>\n</html>\n"
(raiz / "public" / "index.html").write_text(s, encoding="utf-8")
print("Gerado:", raiz / "public" / "index.html", len(s), "bytes")
