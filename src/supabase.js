import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Domínio interno dos logins. A distribuidora digita só "joao"; por baixo
// vira joao@comanda.local no Supabase Auth. Precisa ser IGUAL ao
// LOGIN_DOMAIN do painel CEO (ceo-comanda/api/admin.js).
export const LOGIN_DOMAIN = 'comanda.local'

// Se as chaves não estiverem configuradas, o app mostra um aviso (App.jsx).
export const isConfigured = Boolean(url && key)

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        storageKey: 'comanda-sessao',
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
