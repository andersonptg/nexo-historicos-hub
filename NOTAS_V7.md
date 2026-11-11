# NEXO Históricos HUB V7 — Expansão multiplataforma

## Entregue
- Menu lateral com 15 plataformas e 35 jogos encontrados no catálogo público, exibindo integração pendente onde o resultado ainda não pode ser interpretado com segurança.
- Leitores separados para Double convencional e jogos públicos de multiplicador (Crash, Aviator, Spaceman e variantes) quando o formato é reconhecido. Fonte de terceiros pode falhar ou atualizar com atraso; nunca fabricar registros.
- Ordenação crescente/decrescente, direção visual esquerda/direita, 5/8/10 colunas, HH:mm / HH:mm:ss / HH:mm:ss.SSS com indicação explícita `--` para precisão que a fonte não oferece.
- Fogos opcionais somente quando um **novo branco** for detectado na tela com dados já carregados, respeitando preferência por movimento reduzido.
- Painel `/admin` com login de senha guardada como segredo Cloudflare `ADMIN_TOKEN` (mínimo de 16 caracteres), cookie HttpOnly, limite de tentativas, situação das fontes e controle de pausar/ativar.
- Prévia local de estratégia para futuro Telegram. **Nenhum bot ou envio foi ativado**.
- Coleta manual no painel a cada 20 s por fonte quando o navegador está aberto; atualização do histórico a cada 5 s. Cron a cada minuto prioriza Smash Double e alterna uma outra fonte. Monitoramento não garante tempo real.
- Banco D1 ampliado com `multiplier_rounds`, `source_controls` e `admin_login_attempts`, preservando todas as tabelas e pedras anteriores.

## Segurança e implantação
Não adicione senha, tokens, cookies, Authorization ou chaves ao código ou às mensagens. Em Cloudflare → Workers → nexo-historicos-hub → Settings → Variables and Secrets, crie um segredo do Worker `ADMIN_TOKEN` com senha forte de pelo menos 16 caracteres (não é o token da API da Cloudflare). Depois use `/admin`.

O pacote **não inclui** `wrangler.jsonc` nem substitui o ID do D1. O GitHub Actions já existente aplica as tabelas e faz o deploy após o push.

## Limites da precisão
A fonte pública apresenta predominantemente HH:mm. As opções `HH:mm:ss` e `HH:mm:ss.SSS` não completam informações ausentes com zeros. A ordem dentro do mesmo minuto será reconstruída pelos snapshots quando disponíveis; registros antigos podem não ter posição oficial de chegada.

## Telegram (futuro)
Uma sequência passada como `🔴1 🔴4 🔴4` é apenas uma condição configurável; não comprova que a próxima rodada será preta ou branca. O editor mantém a prévia sem enviar mensagens nem apostar automaticamente.

## Próximos passos após publicar
1. Conferir GitHub Actions (execução verde).
2. Abrir `https://nexo-historicos-hub.lipesanderson.workers.dev` e atualizar a página.
3. Testar menu, Double, Crash, controles de horário, fogos e `/admin`.
4. Conferir o log de cada fonte no painel; fontes indisponíveis devem continuar como tais, sem dados fictícios.
