import {parseSmashHtml} from '../parser.js';
// Um adaptador por fonte. Só habilitar fontes públicas cuja automação seja permitida.
// Fontes futuras devem fornecer: id, url, platform, game, parse(html,epoch).
export const ENABLED_SOURCES = [
  {id:'historicosblaze:smash:double',url:'https://historicosblaze.com/results/smash/double',
    platform:'smash',game:'double',parse:parseSmashHtml,label:'Históricos Blaze (público)'}
];
export const PLATFORMS = [
  {id:'smash',label:'Smash',games:[{id:'double',label:'Double',connected:true}]},
  {id:'brabet',label:'Brabet',games:[{id:'double',label:'Double',connected:false}]},
  {id:'blitz',label:'Blitz',games:[{id:'double',label:'Double',connected:false}]}
];
