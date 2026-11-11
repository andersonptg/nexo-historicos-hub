import {parseSmashHtml, parseMultiplierHtml} from '../parser.js';
// Catálogo público encontrado em Históricos Blaze em novembro de 2026.
// Catálogo != integração: jogos sem parser validado aparecem como pendentes.
const slugs={ 'trade-dolar':'tradedolar','casa-campea':'casacampea','dezenas-club':'dezenasclub' };
const listed = [
 ['blitz','Blitz',[['double','Double'],['fortune-double','Fortune Double'],['crash','Crash'],['crash-2','Crash 2'],['slide','Slide']]],
 ['trade-dolar','Trade Dolar',[['double','Double']]],
 ['813bet','813Bet',[['double','Double'],['crash','Crash'],['car-roulette','Car Roulette']]],
 ['brabet','Brabet',[['double','Double'],['crash','Crash'],['aviator','Aviator']]],
 ['smash','Smash',[['double','Double'],['crash','Crash']]],
 ['winmi','Winmi',[['double','Double'],['crash','Crash']]],
 ['bbrbet','BBRBet',[['double','Double']]],
 ['sssgame','SSSGame',[['double','Double'],['crash','Crash']]],
 ['betfiery','Betfiery',[['crash','Crash'],['spaceman','Spaceman']]],
 ['chillbet','Chillbet',[['double','Double']]],
 ['runwin','RunWin',[['double','Double'],['crash','Crash'],['car-roulette','Car Roulette']]],
 ['casa-campea','Casa Campeã',[['double','Double'],['crash','Crash'],['car-roulette','Car Roulette']]],
 ['pingol','Pingol',[['aviator','Aviator'],['aviator-2','Aviator 2']]],
 ['dezenas-club','Dezenas Club',[['aviator','Aviator'],['aviator-2','Aviator 2'],['aviator-studio','Aviator Studio']]],
 ['evolution','Evolution',[['crazytime','Crazytime'],['crazytime-a','Crazytime A']]],
];
// Apenas formatos efetivamente suportados pelo parser de texto público:
// Double tradicional (0-14) e jogos de multiplicadores terminados em x.
// Outros exigem uma integração própria antes de serem anunciados como ativos.
const typeFor = game => game === 'double' ? 'double' :
 ['crash','crash-2','aviator','aviator-2','aviator-studio','spaceman'].includes(game) ? 'multiplier' : null;
export const PLATFORMS = listed.map(([id,label,games])=>({id,label,games:games.map(([gameId,gameLabel])=>({
 id:gameId,label:gameLabel,kind:typeFor(gameId)||'pending',
 connected:!!typeFor(gameId),
 public_url:`https://historicosblaze.com/results/${slugs[id]||id}/${gameId}`
}))}));
export const ENABLED_SOURCES = PLATFORMS.flatMap(p=>p.games.filter(g=>g.connected).map(g=>({
 id:`historicosblaze:${p.id}:${g.id}`, url:g.public_url, platform:p.id, game:g.id,
 type:g.kind, parse:g.kind==='double'?parseSmashHtml:parseMultiplierHtml,
 label:'Históricos Blaze (público)'
})));
export const sourceFor=(p,g)=>ENABLED_SOURCES.find(x=>x.platform===p&&x.game===g)||null;
export const catalogGame=(p,g)=>PLATFORMS.find(x=>x.id===p)?.games.find(x=>x.id===g)||null;
