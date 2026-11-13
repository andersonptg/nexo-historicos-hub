#!/usr/bin/env python3
"""NEXO - auxiliar leve: aciona coleta autorizada por limite servidor, sem credenciais.
A Cloudflare continua principal; não manda sinais pelo telefone.
"""
import argparse, json, os, pathlib, signal, subprocess, sys, time, urllib.request
HOME=pathlib.Path.home()
PID=HOME/'.nexo_motor_leve.pid'
LOG=HOME/'nexo_motor_leve.log'
URL='https://nexo-historicos-hub.lipesanderson.workers.dev'

def ping():
 req=urllib.request.Request(URL+'/api/tick?platform=smash&game=double',data=b'',method='POST',headers={'User-Agent':'NexoAndroidAux/1.0'})
 with urllib.request.urlopen(req,timeout=15) as r:
  return r.status,r.read(500).decode('utf-8','replace')

def live():
 try:
  pid=int(PID.read_text());os.kill(pid,0);return pid
 except (OSError,ValueError):return None

def serve():
 PID.write_text(str(os.getpid()))
 try:
  while True:
   try:
    status,body=ping()
    print(time.strftime('%Y-%m-%d %H:%M:%S'),status,body[:180],flush=True)
   except Exception as e:print(time.strftime('%Y-%m-%d %H:%M:%S'),'rede:',type(e).__name__,flush=True)
   time.sleep(50)  # respeita no servidor o lease de 45s; sem polling agressivo
 finally:
  if PID.exists() and PID.read_text().strip()==str(os.getpid()):PID.unlink()

def main():
 p=argparse.ArgumentParser();p.add_argument('acao',choices=['iniciar','parar','status','executar']);a=p.parse_args().acao
 if a=='status':print('RODANDO PID '+str(live()) if live() else 'PARADO');print('LOG:',LOG);return
 if a=='parar':
  pid=live()
  if not pid:print('Ja estava parado');return
  os.kill(pid,signal.SIGTERM);print('Parada solicitada');return
 if a=='executar':serve();return
 if live():print('Ja esta rodando');return
 with open(LOG,'a',encoding='utf8') as f:
  obj=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'executar'],stdin=subprocess.DEVNULL,stdout=f,stderr=f,start_new_session=True)
 PID.write_text(str(obj.pid));print('Monitor auxiliar iniciado PID',obj.pid,'(sem wake-lock)')
 print('Termux/Android pode suspender o processo; Cloudflare continua principal.')
if __name__=='__main__':main()
