# NEXO Históricos V9 — Telegram (Smash Double)

## Recursos desta versão

- Integração de saída (Telegram Bot API) usando bot já existente.
- Sem entrada de token no navegador: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no Worker como **Secret**.
- Teste manual seguro no painel administrativo: `/estrategias/smash/double`.
- Envio automático **DESLIGADO por padrão**, separado do monitoramento de estratégias.
- Preferências por tipo de evento: pré-aviso, entrada, Gale 1, Gale 2, WIN, RED, apagar aviso.
- Pré-aviso é removido via `deleteMessage` quando o padrão avança ou é cancelado, conforme permissão do bot.
- Banco D1: fila de eventos com ID único, tentativas, status, última falha e `message_id` retornado pelo Telegram.
- Monitoramento automático V8 continua independente: registrar eventos não depende do Telegram.
- O bot não recebe automaticamente informações antigas: cada resultado deve ser capturado com menos de 3 minutos de diferença do horário registrado.
- Somente Smash Double nesta fase. Outras fontes não são misturadas.

## Configuração — Cloudflare

Cloudflare Dashboard → Workers e Pages → Worker `nexo-historicos-hub` → Configurações → Variáveis e segredos → Produção → **Adicionar variável**:

1. `TELEGRAM_BOT_TOKEN`: Tipo **Secret**. Valor: token do BotFather.
2. `TELEGRAM_CHAT_ID`: Tipo **Secret**. Valor: ID numérico do grupo/chat ou `@nome` do canal público.

Não coloque essas credenciais em `wrangler.jsonc`, GitHub Secrets, mensagens de chat ou print.
**Não compartilhe o token com outras pessoas**. Um token comprometido deve ser revogado no BotFather.

### Como descobrir o chat ID sem expor o token

No Android/Termux:

```bash
python ~/storage/downloads/NEXO_HISTORICOS_V9/files/scripts/OBTER_CHAT_ID.py
```

Envie `/start` ao bot ou mensagem no grupo antes de rodar. O script pergunta o token com entrada oculta e exibe somente os IDs. Se houver webhook configurado no bot, `getUpdates` não funciona: não remova o webhook do sistema anterior; use o chat ID já conhecido ou `@nome` para canal público.

Para um grupo ou canal, adicione o bot e conceda permissões de publicar mensagens e, se quiser remoção do aviso, excluir mensagens.

## Como ativar

1. Publicar V9 pelo script `PUBLICAR.sh` após aplicar e rodar testes.
2. Criar os dois Secrets no Worker e **Implantar**.
3. Entrar no painel administrativo `/estrategias/smash/double`.
4. Na seção **Telegram**, usar **Enviar mensagem de teste**. Conferir o destino!
5. Ativar **Automático** (estratégias V8), criar ao menos uma estratégia e ativá-la.
6. Ativar **Envio automático** na seção Telegram e salvar. Só então serão enviados alertas novos.

## Atenção à precisão e segurança

- O histórico público do Smash monitorado não traz ID oficial da rodada nem segundos/milissegundos. IDs internos do D1 servem só para impedir duplicatas.
- Não é um sistema de previsão; resultados aleatórios podem gerar WIN e RED inesperados, inclusive sequências com Gale.
- Podem ocorrer atrasos da fonte pública e, excepcionalmente, mensagens repetidas se o Telegram confirmar uma mensagem e o banco falhar antes de registrar a confirmação (a API do Telegram não oferece chave de idempotência em `sendMessage`).
- Para evitar mandar sinais desatualizados, eventos antigos não entram na fila e pendências com mais de 3 minutos expiram.
- Não usa autorização nem cookies do jogo, não faz apostas e não altera nenhum bot/webhook existente.
- Telegram Sticker real é melhoria futura — não é enviado nesta versão.

## Banco e deploy

`schema.sql` inclui somente `CREATE TABLE IF NOT EXISTS` e índices. Não apaga dados existentes. GitHub Actions executa o schema antes do deploy. Token do Telegram não está em código-fonte, nem no D1, nem no GitHub.
