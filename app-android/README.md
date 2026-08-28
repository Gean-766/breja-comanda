# 📱 A casca Android do Comanda

Por fora é um aplicativo. Por dentro é o mesmo site de sempre.

Isto aqui **não é uma segunda versão do Comanda**. É uma casca fina que abre o
`https://breja-comanda.vercel.app` numa janela que a gente controla — e é esse
"que a gente controla" que muda tudo: dentro dela o app consegue falar com a
maquininha, coisa que o navegador não deixa.

## O medo que isso desfaz

> "se virar aplicativo, toda correção vira atualização na Play Store"

**Não vira.** O conteúdo continua vindo da Vercel:

| O que você mexe | Como chega no bar |
| --- | --- |
| Tela, relatório, estoque, preço, correção de bug, produto novo | **Na hora**, pela Vercel — exatamente como hoje |
| Ponte com a maquininha, ícone, nome do app, permissão nova | APK novo |

A segunda linha é quase nunca. A ponte de cada maquininha é escrita uma vez e
depois fica parada. Seu dia a dia de mexer no Comanda **não muda em nada**.

E o bar que não instalar o app continua entrando pelo link, como sempre. Os
dois convivem: é o mesmo endereço, o mesmo banco, os mesmos dados.

## Por que Capacitor e não TWA

Um TWA também abriria o site num app da Play Store — mas quem desenha a tela
lá é o **Chrome**, e o JavaScript não tem ponte pro lado nativo. Você teria o
app na loja e continuaria sem conseguir chamar a maquininha: o mesmo bloqueio
de hoje, com mais trabalho.

O Capacitor abre o site numa janela **nossa**, com uma ponte JS ↔ nativo. É por
ela que o "apertei Débito" vira "maquininha acende com R$ 45,50".

## Como pegar o APK

Ninguém precisa instalar Android Studio. Quem monta é o GitHub:

1. No repositório → aba **Actions**
2. Abre a execução mais recente de **APK do Comanda**
3. Lá embaixo, em **Artifacts**, baixa o `comanda-apk`
4. Descompacta, manda o `app-debug.apk` pro celular e instala
   (o Android vai pedir pra liberar "instalar de fonte desconhecida")

O robô roda sozinho quando alguém mexe em `app-android/`, e também dá pra
disparar na mão pelo botão **Run workflow**.

Este APK é de **teste** (assinatura de debug). Pra publicar na Play Store
depois, ele precisa ser assinado com uma chave sua — que aí sim tem que ser
guardada com cuidado, porque se perder não dá pra atualizar o app publicado
nunca mais.

## ⚠️ O `appId` é pra sempre

Está `br.com.comanda.app` no `capacitor.config.json`. **Depois de publicado na
Play Store, esse nome não muda nunca mais** — mudar significa app novo, do
zero, sem os instalados. Se você quiser outro (o seu domínio, por exemplo),
troque **agora**, antes de publicar.

## O que ainda não tem aqui

A ponte com a maquininha. A casca hoje só abre o site — de propósito: primeiro
a gente confirma que ela sobe, que atualiza na hora e que nada quebrou, depois
liga a maquininha nela.

O desenho da ponte, quando entrar, é sempre o mesmo, seja qual for a marca:

```
Comanda (o site)                 A casca                    A maquininha
────────────────                 ───────                    ────────────
aperta "Débito"        →   monta a chamada com o     →   acende com o valor,
R$ 45,50                   valor, o tipo e o             cliente aproxima
                           número do pedido
                                                              ↓
marca a comanda como   ←   recebe aprovado/negado    ←   devolve NSU e
paga SÓ SE APROVOU         + NSU + autorização            autorização
```

O que muda de uma marca pra outra é só o nome dos campos. É por isso que a
primeira dá trabalho e as seguintes são pequenas.

**Importante**: hoje o Comanda marca a comanda como paga no toque do botão.
Com maquininha no meio isso tem que mudar — só marca quando a cobrança voltar
**aprovada**, senão uma transação recusada deixa a comanda fechada e a gaveta
furada. Essa mudança fica no site (`src/App.jsx`), não aqui.

## Mexendo aqui dentro

```
npm install          # uma vez
npx cap sync android # depois de mexer no capacitor.config.json
```

Não precisa rodar nada disso pra publicar: o robô do GitHub já faz.
