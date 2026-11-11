# NEXO Históricos V8 — Estratégias Smash Double

## O que está disponível

- URL exclusiva: `/estrategias/smash/double`, protegida pela mesma sessão administrativa de `/admin`.
- Histórico com rotas próprias: `/resultados/:plataforma/:jogo` (catálogo existente; fonte externa pode estar indisponível).
- CRUD de estratégias Smash Double: adicionar, editar, duplicar, ativar, pausar e excluir.
- Padrões de 2 a 12 resultados e alvos de 1 a 4 alternativas, usando cores, números exatos ou mistura.
- Pré-aviso no prefixo (primeiros N-1 elementos), cancelamento/limpeza quando o próximo resultado chega.
- Entrada somente após o padrão N completo; WIN/RED avaliados em resultados posteriores à entrada.
- Gale máximo 0, 1 ou 2 e edição de modelos de mensagens.
- Registro de eventos no Cloudflare D1, com IDs idempotentes e cursor de coleta por fonte.
- Monitoramento automático administrável (desligado inicialmente), painel com opção de fogos no branco.
- Simulação histórica sem gravar alertas ou fazer apostas.
- Todas as operações administrativas exigem sessão HTTP-Only segura, mesma origem e `ADMIN_TOKEN` do Worker.

## Limitações explícitas

- **Telegram NÃO está conectado.** As mensagens são geradas/registradas no painel, não enviadas. Nenhum sticker real é enviado nem uma aposta é feita.
- A fonte Históricos Blaze publica dados por minuto sem ID oficial/segundos/milissegundos. A coleta pode atrasar, falhar ou entregar dois resultados juntos. O sistema não gera timestamps falsos.
- Na primeira coleta após instalar V8 o cursor inicializa sem disparar sinais antigos. Habilite o automático e aguarde novos resultados.
- Caso ocorram lacunas grandes sem o cursor anterior no snapshot ou resultados retroativos, o mecanismo deixa de gerar sinais para esses trechos e reinicializa o cursor, evitando alertas inventados.
- A automação e os alvos cadastrados são uma forma de testar observações; não preveem resultados aleatórios nem garantem lucro. Com Gale 2 o risco aumenta.
- O sistema ainda depende de limites gratuitos do Cloudflare D1 e disponibilidade/condições de uso da fonte pública.

## Configurar senha administrativa

No painel da Cloudflare, abra Worker `nexo-historicos-hub` → Settings / Variables and Secrets → add Secret chamado `ADMIN_TOKEN`, com senha forte de ao menos 16 caracteres. **Nunca coloque o valor no GitHub, no chat ou no HTML.**

Abra `https://nexo-historicos-hub.lipesanderson.workers.dev/estrategias/smash/double`, faça login e cadastre uma estratégia. Ative o monitoramento apenas após conferir as opções. As duas estratégias de exemplo são incluídas manualmente pelo botão e entram desativadas.

## Banco

`schema.sql` só acrescenta tabelas V8 com `CREATE TABLE IF NOT EXISTS`. Não contém `DROP TABLE`, não remove `rounds` e não atualiza a estrutura das tabelas anteriores.
