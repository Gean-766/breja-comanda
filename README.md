# 🍺 Comanda — Mutum

Controle simples de cervejas para distribuidora. Um **link**, sem app, números
grandes (estilo contador de truco). Anota a cerveja por pessoa, soma o valor,
marca o horário e fecha a conta quando paga.

## Como funciona
- **Comandas**: adiciona a pessoa pelo nome, escolhe a cerveja e a quantidade (− / +).
  Cada toque já soma o valor e grava o horário. Para procurar alguém, use a busca.
- Toque no nome para ver tudo o que a pessoa pegou, o total e **Pagar/Fechar**.
- **Cervejas**: cadastra as cervejas e ajusta os preços.

## Passos para colocar no ar

### 1. Banco de dados (Supabase)
1. Entre no seu projeto Supabase.
2. Menu **SQL Editor → New query**.
3. Cole todo o conteúdo de `supabase/schema.sql` e clique **Run**.

### 2. Chaves
1. No Supabase: **Project Settings → API**.
2. Copie a **Project URL** e a chave **anon public**.
3. No projeto, abra o arquivo `.env` e cole:
   ```
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-anon
   ```

### 3. Rodar no seu PC (teste)
```
npm install
npm run dev
```
Abra o endereço que aparecer (ex: http://localhost:5173).

### 4. Publicar (Vercel = vira um link)
1. Suba este projeto no GitHub.
2. Na Vercel: **Add New → Project → Import** o repositório.
3. Em **Environment Variables**, adicione as mesmas duas chaves
   (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`).
4. **Deploy**. A Vercel te dá o link final.

> Framework: Vite. Build: `npm run build`. Saída: `dist` (a Vercel detecta sozinha).
