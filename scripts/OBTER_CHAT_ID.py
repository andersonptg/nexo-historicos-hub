#!/usr/bin/env python3
# Termux: obter IDs de chat sem armazenar token em arquivo ou no historico shell.
# NAO altera webhook e NAO faz postagens.
import getpass, json, urllib.request, urllib.error

token = getpass.getpass('Cole o token do BotFather (entrada oculta): ').strip()
if not token or ':' not in token:
    raise SystemExit('Token invalido. Nao envie a credencial para ninguem.')
try:
    url = 'https://api.telegram.org/bot' + token + '/getUpdates?limit=30&timeout=0'
    with urllib.request.urlopen(url, timeout=15) as resp:
        result = json.load(resp)
except urllib.error.HTTPError as exc:
    if exc.code == 409:
        raise SystemExit('O bot possui webhook ativo. getUpdates nao funciona junto com webhook. Nao desative seu webhook existente. Use o ID do seu chat/canal ja conhecido, ou um canal publico com @usuario.') from None
    raise SystemExit('Telegram retornou HTTP %s. Verifique o token e a conexao.' % exc.code) from None
except Exception as exc:
    raise SystemExit('Falha ao consultar Telegram: ' + type(exc).__name__) from None
if not result.get('ok'):
    raise SystemExit('A API nao confirmou a consulta.')
seen = {}
for update in result.get('result', []):
    for category in ('message', 'channel_post', 'edited_message', 'edited_channel_post', 'my_chat_member'):
        event = update.get(category) or {}
        chat = event.get('chat') or {}
        if 'id' in chat:
            seen[str(chat['id'])] = (chat.get('title') or chat.get('first_name') or chat.get('username') or 'Sem nome', chat.get('type') or '?')
if not seen:
    print('Nenhum chat encontrado. Converse com o bot usando /start ou envie uma mensagem no grupo onde ele foi adicionado e execute novamente.')
else:
    print('Chats encontrados (valores do campo TELEGRAM_CHAT_ID):')
    for chat_id, (name, typ) in seen.items():
        print('  %s | %s | %s' % (chat_id, typ, name))
    print('Para canais publicos, voce tambem pode usar @nomedocanal se o bot tiver permissao de publicar.')
print('Token nao foi exibido e nao foi salvo.')
