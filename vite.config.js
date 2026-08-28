import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' e não 'autoUpdate': com autoUpdate a versão nova trocava
      // sozinha e em silêncio — o garçom seguia com a tela antiga sem saber
      // que existia coisa nova, e uma troca de preço podia demorar a noite
      // toda pra chegar nele. Agora o app AVISA e ele toca pra atualizar.
      // Ver src/atualizacao.js.
      registerType: 'prompt',
      // o registro passou a ser feito na mão (src/atualizacao.js), porque é
      // de lá que sai o aviso na tela
      injectRegister: null,
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'BREJA & CIA — Comanda',
        short_name: 'Comanda',
        description: 'Comanda da distribuidora',
        lang: 'pt-BR',
        theme_color: '#14141d',
        background_color: '#14141d',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell funciona offline; chamadas ao Supabase tentam a rede primeiro
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase',
              networkTimeoutSeconds: 5,
              // Guardava 24 HORAS. Numa internet ruim — não caída, só lenta — a
              // tela podia mostrar uma comanda de ontem parecendo normal, e o
              // cadeado de conexão não percebia: ele testa a rede por um caminho
              // que não passa por aqui. Era o furo exato que o cadeado existe pra
              // tapar, pela porta que ele não vigia.
              // 5 minutos: o suficiente pra atravessar um engasgo de sinal, curto
              // demais pra alguém cobrar em cima de comanda velha.
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
    }),
  ],
})
