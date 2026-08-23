# Orbit

App de desktop (Electron) para conversas, chamadas de voz e compartilhamento de tela entre amigos, inspirado visualmente no Discord.

## Como rodar

```bash
npm install
npm start
```

Na primeira execução, essa instância também sobe o servidor de sinalização local (porta `4732`, apenas em `127.0.0.1`) que guarda usuários, amigos e mensagens em `data/db.json`.

## Testando localmente com duas "pessoas"

Como é um teste local (uma máquina só), cada janela precisa de uma identidade própria. Use `--profile` para isolar o login de cada janela:

```bash
npm start                       # primeira pessoa (perfil "default")
npm start -- --profile=2        # segunda pessoa, em outra janela/terminal
```

A primeira instância aberta assume o papel de servidor; as demais apenas se conectam a ela. **Não fixe a primeira janela como a única** — se ela for fechada, o servidor cai junto e as outras janelas perdem a conexão. Para uma sessão mais estável, rode o servidor separado num terminal à parte:

```bash
node server/start.js
```

e então abra quantas instâncias quiser com `npm start -- --profile=N`, todas se conectando a esse servidor.

Cada perfil salva seu próprio login em `%APPDATA%/orbit-chat/profile-N/session.json` — é assim que "Aline#1133" e "Marcos#2497" continuam sendo pessoas diferentes mesmo reabrindo o app depois.

## O que dá pra testar

- Criar perfil (nome + tag gerada automaticamente, ex: `Aline Ferraz#1133`)
- Editar foto, nome, status (online/ausente/não perturbe/invisível) e mensagem de status
- Adicionar amigos pelo `nome#tag`, aceitar/recusar/cancelar pedidos
- Conversar por texto em tempo real
- Ligar para um amigo (voz, via WebRTC) direto da lista de amigos ou do cabeçalho da conversa
- Compartilhar tela durante uma chamada (usa o seletor nativo de janela/tela do Electron)

## Escopo e limitações conhecidas

- Chamada é 1:1 (sem chamadas em grupo)
- Sem TURN server: funciona bem na mesma máquina/rede local; atrás de NATs mais restritivos em internet aberta pode falhar a conexão P2P
- Persistência em arquivo JSON simples (`data/db.json`), não um banco de verdade — ótimo para testar, não para produção
