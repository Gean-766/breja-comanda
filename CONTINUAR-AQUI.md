# 📌 CONTINUAR AQUI — maquininha no Comanda

> Bloco de notas do projeto. **Atualizado em 28/08/2026.**
>
> **Combinado com o Gean:** quando ele falar *"vamos pausar"*, eu escrevo aqui
> onde parou, antes de qualquer outra coisa. Este é o único arquivo de anotação
> do projeto — não criar outro.
>
> **Lê tudo antes de escrever uma linha de código**, principalmente o item 6
> (caminhos descartados): cada um deles a gente já andou e já voltou.

---

## 0. O MAPA — são DOIS sistemas, não um

Isso não estava anotado antes e é essencial:

| Sistema | Endereço | Repositório | O que é |
| --- | --- | --- | --- |
| **Comanda** | `breja-comanda.vercel.app` | `Gean-766/breja-comanda` | O app do bar. Garçom, caixa, estoque |
| **CEO** | `ceo-comanda.vercel.app` | `Gean-766/ceo-comanda` | Painel do Gean. Clientes, mensalidade, backup |

**Os dois falam com o MESMO Supabase:** `dmsqjwwcmfgdsrdsnlma.supabase.co`.
Confirmado em `ceo-comanda/api/admin.js`.

O CEO é um `index.html` só + `api/admin.js` (serverless, guarda a service_role
fora do navegador). O Comanda é React/Vite.

**Consequência prática:** o app da maquininha é o mesmo Comanda por dentro, logo
**continua conversando com o CEO exatamente como hoje.** Mesmo banco, mesmos
dados, mesma mensalidade. Nada a fazer pra isso funcionar.

**Cliente hoje:** Bola 7 — Adenilton, 99988451417, Nova Mutum, login `bola7`,
R$ 50,00, vence dia 14, ativo.

---

## 1. ONDE PAROU

**No ar pro bar de verdade:** commit `dcc2699` (aba Ontem). Testado, funcionando.

**Só no PC do Gean, SEM commit e SEM push:**

| Pasta / arquivo | O que é |
| --- | --- |
| `app-android/` | A casca Capacitor, já gerada e configurada (59 arquivos) |
| `.github/workflows/apk.yml` | O robô que monta o APK no GitHub |
| `supabase/backup-gera-restauracao.sql` | Backup antigo, com furo (ver item 7) |
| `CONTINUAR-AQUI.md` | Este arquivo |

**`src/` está intacto desde o último push.** Confere com:

    git log --oneline -1 origin/main     # tem que dar dcc2699
    git status --porcelain -- src/       # tem que vir vazio

---

## 2. O QUE O GEAN QUER (nas palavras dele)

> "quando ele apertava em débito dentro do Comanda e selecionava a máquina que
> ele quer passar, já aparecia lá o valor aberto pro cara passar a máquina"

Resolve duas coisas: **acaba a digitação na maquininha** e **acaba o erro de
valor**.

E não pode custar nada do que já é bom hoje: garçom vai na mesa, três toques,
lançou. **Se a mudança atrapalhar isso, ela não presta.**

**Pedido novo (28/08):** um cliente perguntou se dá pra ter *"o sistema dentro
da maquininha, estoque pela maquininha"*. É o mesmo problema resolvido pelo
outro lado — e virou o caminho principal.

**Pano de fundo:** R$ 50/mês por bar. Hoje 1 bar. Atender várias marcas de
maquininha é pra vender pra mais bares, não é capricho técnico.

---

## 3. AS 5 MAQUININHAS — IDENTIFICADAS EM CAMPO (28/08)

O Gean foi nos lugares e trouxe número de série. **Todas são Android smart.**
Nenhuma descartada.

| Marca | Hardware real | Android | Serial anotado |
| --- | --- | --- | --- |
| **Cielo** | **PAX A930** | 7.1 | ANATEL 08273-17-09939 |
| **Moderninha Smart** (PagBank) | **PAX A930** | 7.1 | `A930-0AW-RD5-07EB` S/N 1170152229 |
| **Moderninha Smart 2** (PagBank) | não confirmado | ? | S/N PBA1241F78220, ID 2026A08D |
| **Stone** | `T6900` = **Sunmi P2** | sim | S/N PB08218472235 |
| **Sicredi** | **Ingenico AXIUM DX8000** | **10** | PN TWS52013354B, SN 24B4FD801384 |

**Dois achados que valem ouro:**

1. **Cielo e Moderninha Smart são o MESMO aparelho** (PAX A930). O app que rodar
   numa roda na outra — só o pedaço do pagamento muda.
2. **O SDK do PagBank suporta oficialmente o A930, e só ele.** Melhor
   documentação de todas.

**⚠️ Risco aberto:** o A930 roda **Android 7.1 (de 2016)**. O navegador interno é
velho e o Comanda é React moderno. **Pode abrir torto.** É o pior caso das cinco
(a Sicredi é Android 10) — **se rodar no A930, roda em todas.** Precisa de teste
físico. Ainda não feito.

**Prioridade do Gean:** Sicredi, Cielo, Stone, InfinitePay e Moderninha.
As duas máquinas da oficina do amigo ficam pra depois — eram só exemplo.

---

## 4. COMO VAI SER O APP — um código, cinco sabores

Não são cinco aplicativos. É um só, que na hora de montar sai em cinco versões,
cada uma carregando só o SDK da sua marca.

    breja-comanda  (o repositorio que ja existe)
    |
    +-- src/            <- o Comanda de hoje. React. NAO e tocado.
    |
    +-- app-android/    <- a casca Capacitor, ja criada
        |
        +-- ponte.js         <- uma funcao so: cobrar(valor, tipo)
        |
        +-- adaptadores/     <- Kotlin, um por marca
            +-- cielo/       SDK LIO
            +-- stone/       SDK Stone
            +-- pagbank/     PlugPag
            +-- sicredi/     SDK deles
            +-- infinity/    deep link

**Linguagem: Kotlin.** O Gean não precisa aprender.

**A tela continua vindo da Vercel, dentro do app.** Isso é inegociável:

| O que mexer | Como chega no bar |
| --- | --- |
| Tela, cor, preço, produto, relatório, estoque, bug | **Na hora**, pela Vercel — igual hoje |
| Ponte de pagamento, ícone, permissão | APK novo + homologação |

Se embutir o site no APK, toda correção de preço vira homologação em 5 lojas
diferentes. Inviável.

---

## 5. ⚠️ PLAY STORE **NÃO** É O CAMINHO PRAS MAQUININHAS

Erro de premissa corrigido em 28/08. O fluxo que o Gean usa no PromoMutum
(Git → Codemagic → Play Console → teste de 14 dias) **é fluxo de celular.**

| | Celular | Maquininha |
| --- | --- | --- |
| Onde publica | Google Play | Loja da adquirente |
| Quem aprova | Google | Cielo / PagBank / Stone / Sicredi |
| Teste de 14 dias | Sim | **Não existe** |

**O Codemagic continua servindo** — monta o arquivo igual, só o destino muda.
(O `.github/workflows/apk.yml` já faz isso de graça, mas tanto faz.)

---

## 6. ⛔ CAMINHOS JÁ DESCARTADOS — NÃO VOLTAR PRA ELES

| Caminho | Por que morreu |
| --- | --- |
| **TWA** | Quem desenha a tela é o Chrome e **não tem ponte JS↔nativo**. Teria o ícone e o mesmo bloqueio de hoje. Confirmado 2x. |
| **Web Bluetooth / navegador falando com a maquininha** | Protocolo fechado, exige SDK, e iPhone nem tem a API. |
| **NFC lendo cartão direto** | Exige certificação EMV/PCI. |
| **TEF multiadquirente (SiTef, PayGo, Connect)** | Tecnicamente certo, mas tem mensalidade por PDV. Com 1 bar a R$ 50 não fecha. Revisitar acima de ~10 bares. |
| **Só Pix com QR** | Funciona e é grátis, mas não é o que o Gean pediu. Fica como ideia lateral. |
| **API remota da Cielo (valor via internet, sem app)** | Existe e funcionaria, mas o **Gean descartou em 28/08**: quer app nativo pra todas, não solução que só serve a Cielo. |

---

## 7. BACKUP — O PASSO ZERO **MUDOU** (descoberto 28/08)

Eu ia escrever um SQL novo. **Não precisa.** O painel CEO **já tem botão de
backup** (commit `6b86fea`, "Botao de backup no painel").

Ele cobre 9 tabelas, em `ceo-comanda/api/admin.js` → `ALLOWED_TABLES`:

    distribuidoras, pagamentos, cervejas, clientes, consumos,
    historico, estoque_entradas, pagamentos_parciais, perdas

**O que falta ali:**

- ❌ `caixas` — os turnos. Justo o que a gente acabou de consertar.
- ❌ `caixas_dia_backup` — o desfazer daquela correção.

**O conserto é acrescentar essas duas na lista** — no `ceo-comanda`, não no
`breja-comanda`. É mudança pequena, aditiva, e o Gean já sabe usar o botão.

O `supabase/backup-gera-restauracao.sql` (o dos 5 SELECTs manuais, preso na
Bola 7) fica como plano B. **Não vale reescrever.**

---

## 8. COMO NÃO ESTRAGAR O BOLA 7

Preocupação do Gean: *"esse Bola 7 o cara já está trabalhando, não podemos
estragar ele por nada"*. Ele sugeriu copiar o código pra outro lugar.

**Copiar não. Branch.** Copiar cria dois códigos que divergem e nunca mais se
juntam.

| Camada | Como protege |
| --- | --- |
| **Branch `maquininha`** | `main` continua sendo o que está no ar. A Vercel publica a branch num **endereço separado** automaticamente |
| **Conta `teste`** | Distribuidora própria do Gean, R$ 1,00. O RLS isola do Bola 7 |
| **O navegador não muda** | A ponte só existe dentro da casca. Quem entra pelo link roda o código de hoje |

**E dá pra fazer simultâneo:** conserto urgente no Bola 7 sai pelo `main` na
hora, sem esperar a maquininha ficar pronta.

---

## 9. FATOS QUE CUSTARAM PESQUISA (não pesquisar de novo)

**Custo de publicar nas lojas das adquirentes — confirmado em doc pública:**

| | Custo | Prazo | Observação |
| --- | --- | --- | --- |
| **Cielo** | **Gratuita** (escrito) | Certificação **2 dias** | Tem distribuição **privada** (só pras máquinas dos clientes dele) e **pública** (todas as LIO do Brasil, Cielo cobra e repassa) |
| **PagBank** | Nenhuma taxa na doc | Homologação **7 dias úteis**, update 24h | Distribui por "grupo/Reseller": vincula o terminal do cliente ao grupo dele |
| **Stone / Sicredi / InfinitePay** | Não achado | — | Perguntar |

**O gate não é dinheiro, é empresa.** O PagBank exige parceria comercial ativa e
*"valida sua empresa"*. Se o Gean não tiver CNPJ, trava aí.

**Adquirente empresta máquina de homologação pra parceiro cadastrado.** O
PagBank fala em "terminal de debug". **O Gean não precisa pegar a máquina de
lojista nenhum.**

**InfinitePay — deep link, público, sem cadastro:**

    infinitepaydash://infinitetap-app
      ?amount=4550                    (centavos, minimo 100)
      &payment_method=debit           (ou credit)
      &installments=1                 (obrigatorio se credit)
      &order_id=1294
      &result_url=<URL encoded>
      &app_client_referrer=Comanda

Volta com `nsu`, `aut`, `card_brand`. **O cartão é aproximado NO CELULAR**
(InfiniteTap), não na maquininha. Gean ainda não confirmou se topa.
A Maquininha Smart da InfinitePay **parece fechada** pra app de terceiros — é a
única das cinco sem caminho claro.

**Nenhuma adquirente cobra pela integração.** Ganham na taxa da transação.

**Já tem concorrente fazendo isso:** PDV homologado nas SIPAG (Sunmi P2, X990,
DX8000) vendendo estoque + pagamento integrado. O modelo é validado.

**Testar cobrança é dinheiro de verdade.** Não tem simulador do fluxo de
aproximação. Cada marca custa algumas transações de R$ 1,00 com estorno.

---

## 10. PENDENTE COM O GEAN

1. **CNPJ** — tem empresa aberta? É o gate do PagBank.
2. **Cadastros de parceiro integrador** — os 5, em paralelo. É o item mais lento
   e não depende de código. Ainda não começados.
3. **Topa o cartão ser aproximado no celular** (InfiniteTap)? Se não, a
   InfinitePay fica sem caminho.
4. **`appId`** — está `br.com.comanda.app` no `app-android/capacitor.config.json`.
   Depois de publicado não muda mais.
5. **Commitar o que está solto?** `app-android/` e este arquivo só existem no PC
   dele. HD morreu, morreu junto.
6. **Teste grátis pendente:** abrir `breja-comanda.vercel.app` no navegador de um
   PAX A930 e ver se a tela aguenta. Custo zero, resolve o risco do item 3.

---

## 11. REGRAS QUE NÃO PODEM SER QUEBRADAS

- **O bar está trabalhando.** Mudança é aditiva. Não apaga estoque, não apaga
  relatório, não apaga venda. Alterar pode; apagar não.
- **"Dia" é a NOITE do bar**, nunca o calendário — turno de caixa + virada às
  05:00. Recorte por data passa por `janelaDoDia` / `diaAtualDoBar` no `App.jsx`.
- **O relógio do aparelho é UTC-4** (1h atrás de São Paulo). Todo SQL com data
  precisa de `at time zone 'America/Cuiaba'`. Ver `supabase/caixa-corrige-dia.sql`.
- **Nada de venda fora de caixa aberto.** Pedido explícito do dono.
- **Só marca a comanda como paga quando a cobrança voltar APROVADA.** Hoje é
  marcada no toque do botão; com maquininha no meio isso TEM que mudar, senão
  transação recusada deixa comanda fechada e gaveta furada. Mudança no
  `src/App.jsx`, não na casca.

---

## 12. PRIMEIRA COISA A FAZER

1. Ler este arquivo inteiro (principalmente o item 6).
2. Conferir que `origin/main` está em `dcc2699` e `src/` limpo.
3. **Backup:** acrescentar `caixas` e `caixas_dia_backup` no `ALLOWED_TABLES` do
   `ceo-comanda/api/admin.js` (item 7). Pequeno, aditivo.
4. Parar e esperar o Gean rodar o backup e conferir.
5. Só então: criar a branch `maquininha` e subir a casca.
