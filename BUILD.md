# Gerando e distribuindo o Orbit

O app troca entre dois modos pela constante `SERVER_URL` em `shared/constants.js`:

- **Dev local**: `SERVER_URL = 'http://localhost:4732'` — o app tenta hospedar o servidor embutido (ver `main.js`), do jeito que era usado pra testar sozinho no PC.
- **Build de distribuição**: `SERVER_URL` apontando para o servidor hospedado (hoje, `https://orbit-signaling.onrender.com`) — o app nunca tenta hospedar servidor local, só se conecta a esse endereço. É esse modo que deve estar ativo antes de gerar o instalador.

## Modelo de distribuição: instalador + atualização automática

Desde a versão 1.1.0 o Orbit não é mais distribuído como um `.exe` portátil avulso. Agora é um **instalador de verdade** (NSIS): instala uma única vez em `%LOCALAPPDATA%\Programs\Orbit`, cria atalho na área de trabalho e no menu iniciar, e a partir daí o próprio app verifica sozinho (a cada hora, e ao abrir) se existe uma versão mais nova publicada no GitHub Releases deste repositório. Se existir, baixa em segundo plano e instala na próxima vez que o app for fechado e reaberto — sem precisar mandar um `.exe` novo pra ninguém.

Isso só funciona para quem instalou pelo instalador (não existe mais o modo portátil). O repositório precisa continuar **público** no GitHub para o app conseguir checar releases sem precisar de nenhum token.

## Passo a passo para lançar uma nova versão

1. Confirme que `shared/constants.js` está com a URL do servidor hospedado.
2. Suba o número de versão em `package.json` (campo `"version"`) — o auto-update só dispara se a versão nova for maior que a instalada. Ex: `1.1.0` → `1.1.1`.
3. Gere o instalador:
   ```
   npm run dist
   ```
4. Isso gera em `dist/`:
   - `Orbit Setup <versão>.exe` — o instalador em si
   - `Orbit Setup <versão>.exe.blockmap`
   - `latest.yml` — o "manifesto" que o app de todo mundo consulta pra saber se tem versão nova
5. Crie uma nova [Release no GitHub](https://github.com/AlvesBernardo626/orbit-chat-app/releases/new):
   - **Tag**: exatamente `v<versão>` (ex: `v1.1.1`) — o "v" na frente é obrigatório
   - Anexe os **3 arquivos** gerados no passo 4 (o `.exe`, o `.blockmap` e o `latest.yml`)
   - Publique a release
6. Pronto — todo mundo que já tem o Orbit instalado vai receber a atualização sozinho, sem precisar reinstalar nada. Quem ainda não tem o app, baixa o instalador dessa mesma página de Releases uma única vez.

## Atualizando o servidor depois

Se você alterar código em `server/` ou `shared/`, dê push pro GitHub — o Render redesploya sozinho a cada push na branch conectada. Não precisa gerar um novo instalador a não ser que tenha mudado algo do lado do cliente (`main.js`, `preload.js`, `renderer/`).
