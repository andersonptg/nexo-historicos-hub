# NEXO Históricos HUB — v5

**Site público independente do aplicativo NEXO Social.** Grade responsiva de Double, filtros, estatísticas retrospectivas, exportação CSV, checagem visual de 5 em 5 segundos e coleta pública agendada a cada minuto.

## O que está pronto

- Layout dark responsivo, **5 colunas no celular e 10 em tela larga**.
- Módulo **Smash / Double / Históricos Blaze**: coletor do HTML público, sem cookies nem API protegida.
- Banco D1 persistente; reconciliação de snapshots para não duplicar resultados ao deslocar a lista.
- Separação entre **público aproximado** (minuto, sem ID oficial) e **oficial importado** (segundos/ID, quando houver).
- API somente de leitura `/api/status`, `/api/platforms`, `/api/results`, `/api/export.csv` e `/api/health`.
- Filtros por cor/número/datas, paginação, grade/lista, estatísticas descritivas, exportação CSV.
- Status de fonte, últimas consultas, aviso de atraso e funcionamento mesmo após fechar o Termux.
- GitHub Actions testa e publica após cada push para `main` **após configuração de credenciais**.
- Script de exportação do SQLite da V4 para D1 (`scripts/export_v4_to_d1.py`).

## Importante: limites verdadeiros

A fonte de terceiros mostra **horário por minuto**, sem ID oficial, com possível atraso. O site verifica **o nosso banco** a cada 5 segundos; o Cron da Cloudflare consulta a página **no máximo uma vez por minuto**, sujeito a atrasos e limitações do provedor. **Não existe garantia de resultado exato ou em tempo real.** Consultar mais frequentemente não altera a velocidade da publicação original.

Coletas periódicas automatizadas também podem estar sujeitas aos termos de uso da fonte. Antes de ativar em produção, confirme permissão e limites de acesso; se a fonte restringir automação, substitua-a por uma integração autorizada. Nunca contorne HTTP 401 de uma API privada.

Brabet e Blitz estão apenas na lista de expansão e **não estão conectadas**; adicionar uma exige adaptador para fonte que permita acesso público automatizado.

## Publicar em nuvem (GitHub + Cloudflare)

1. Faça backup do Termux V4 antes de mexer em qualquer coisa:
   `cp ~/smash_coletor/smash_historico.sqlite3 ~/storage/downloads/smash_historico_v4_backup.sqlite3`
2. Crie um **repositório separado** no GitHub, chamado `nexo-historicos-hub` (não usar o repositório do NEXO Social). No Termux, após instalar `git` e `gh`, você pode executar `bash scripts/PUBLICAR_NO_GITHUB_TERMUX.sh` para autenticar pelo navegador, criar o repositório e enviar o projeto automaticamente. Outra opção é subir o conteúdo descompactado da pasta manualmente, incluindo `.github/workflows`.
3. No Cloudflare Dashboard, crie um banco **D1** chamado `nexo-historicos-hub`. Copie o `database_id` fornecido no painel.
4. Abra `wrangler.jsonc` no GitHub e substitua `COLE_AQUI_O_ID_DO_SEU_D1` pelo identificador real do banco.
5. Crie um **API Token do Cloudflare** com as permissões necessárias para publicar Workers e alterar D1. Em GitHub → repositório → Settings → Secrets and variables → Actions, configure **CLOUDFLARE_API_TOKEN** e **CLOUDFLARE_ACCOUNT_ID**. Nunca publique a chave no chat, código ou README.
6. Em GitHub → Actions → **Publicar NEXO Históricos no Cloudflare** → `Run workflow` para construir, preparar tabelas e publicar. Novos pushes em `main` acionam o mesmo fluxo.
7. Abra a URL `https://nexo-historicos-hub.<seu-subdominio>.workers.dev` apresentada no Cloudflare. O cron roda automaticamente a cada minuto, mesmo com o celular desligado.
8. Confira `/api/status` depois de uma ou duas execuções. Se mostrar erro (403/429, formatação diferente ou bloqueio), ele **não** significa que os resultados estejam atualizados. Verifique as permissões de uso e a integração da fonte.

### Migrar histórico da V4

No Termux, no local onde está o script Python:

```bash
python scripts/export_v4_to_d1.py ~/smash_coletor/smash_historico.sqlite3 > historico_v4.sql
```

Faça uma cópia do banco antes. O arquivo `historico_v4.sql` conterá apenas números, cores, horários, IDs oficiais importados e origem, **não cookies ou senhas**. Para carregar os dados no D1, use o painel do D1/console Wrangler autorizado. Depois do primeiro deploy, a atualização seguirá automática e não dependerá desse arquivo. **Não suba o histórico pessoal ao repositório público.**

## Desenvolvimento local

Precisa de Node 22+, npm e Wrangler. Os testes de parser não exigem rede:

```bash
npm install --no-audit --no-fund
npm test
```

O teste real de HTML público **não** foi possível neste ambiente de criação e deve ser feito depois do primeiro deploy, verificando `/api/status` e a grade. Verificar disponibilidade da URL isoladamente não significa que o parser reconheceu os dados.

## APIs

- `/api/results?platform=smash&game=double&precision=minute&limit=150&offset=0`
- `/api/results?platform=smash&game=double&precision=second&color=red`
- `/api/status` (estado do coletor)
- `/api/export.csv?platform=smash&game=double&precision=minute` (até 5.000 registros)

O endpoint `/api/sync` aceita POST apenas quando `ADMIN_TOKEN` estiver configurado como segredo no Worker e o token estiver no cabeçalho `X-Admin-Token`. Não usar esse recurso se não precisar; o Cron já automatiza a coleta.

**Observação:** GitHub é repositório/publicação de código, não substitui D1 nem a coleta. Este projeto é independente, não altera o NEXO Social nem o painel V4 atual.
