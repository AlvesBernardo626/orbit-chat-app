# Gerando o .exe para distribuir

O app troca entre dois modos pela constante `SERVER_URL` em `shared/constants.js`:

- **Dev local**: `SERVER_URL = 'http://localhost:4732'` — o app tenta hospedar o servidor embutido (ver `main.js`), do jeito que era usado pra testar sozinho no PC.
- **Build de distribuição**: `SERVER_URL` apontando para o servidor hospedado (hoje, `https://orbit-signaling.onrender.com`) — o app nunca tenta hospedar servidor local, só se conecta a esse endereço. É esse modo que deve estar ativo antes de gerar o `.exe`.

## Passo a passo

1. Confirme que `shared/constants.js` está com a URL do servidor hospedado.
2. Gere o instalador portátil:
   ```
   npm run dist
   ```
3. O `.exe` sai em `dist/Orbit 1.0.0.exe` (ou nome parecido) — é um arquivo único e portátil, não precisa instalar nada, seus amigos só clicam duas vezes para abrir.

## Atualizando o servidor depois

Se você alterar código em `server/` ou `shared/`, dê push pro GitHub — o Render redesploya sozinho a cada push na branch conectada. Não precisa gerar um novo `.exe` a não ser que tenha mudado algo do lado do cliente (`main.js`, `preload.js`, `renderer/`).
