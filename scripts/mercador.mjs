/**
 * Mercadores — atores do tipo "Mercador" (deste módulo) que são lojas.
 *
 * O estoque é o INVENTÁRIO do ator: só o que está lá (e na quantidade que
 * está) pode ser comprado. O caixa é o DINHEIRO do ator: o mercador recebe
 * o que os personagens pagam e só compra deles enquanto tiver moedas.
 *
 * Por cima disso, cada mercador pode ter um "catálogo da comunidade": itens
 * do catálogo geral da loja que ele vende sem limite de quantidade, filtrados
 * pelas regras de economia do Livro Básico (p. 271): aldeia, vila, cidade e
 * metrópole. "Gerar estoque" rola as quantidades e o caixa dessas regras.
 *
 * Quem compra quase nunca é dono do ator do mercador, então as mudanças no
 * mercador (tirar do estoque, receber, pagar) vão por socket para um mestre
 * conectado, que as executa uma por vez.
 */

import { MODULE_ID } from './main.js';

const FLAG = 'mercador';

/** Tipo de ator dos mercadores (módulo + subtipo, como o Foundry nomeia). */
export const TIPO_MERCADOR = 't20-hayd-loja.mercador';

/* ─────────────────────────────────────────────
   Comunidades (Livro Básico, p. 271)
───────────────────────────────────────────── */

/**
 * O que cada tipo de comunidade oferece. `catalogo` é o que o mercador vende
 * sem limite; `gerar` é o que "Gerar estoque" coloca no inventário com
 * quantidade rolada; `caixa` é a rolagem do dinheiro disponível.
 */
export const COMUNIDADES = {
  aldeia: {
    rotulo: 'Aldeia',
    icone: 'fa-wheat-awn',
    populacao: 'Até 1.000 habitantes',
    economia: 'Um único armazém. Só itens de até T$ 50, em quantidades limitadas (1d6 de cada). Caixa de 1d4 × T$ 100.',
    interpretacao: 'Gerar estoque sorteia uma parte (variedade ajustável, 40% por padrão) dos itens de até T$ 50 e rola 1d6 de cada. Sem encomendas.',
    catalogo: { ativo: false, precoMax: 50, excluirRaros: false, magias: false },
    gerar: { precoMax: 50, comuns: '1d6', sortimento: 40, raros: null, valiosos: null },
    caixa: { formula: '1d4 * 100', ilimitado: false },
    superiores: false,
  },
  vila: {
    rotulo: 'Vila',
    icone: 'fa-house-chimney',
    populacao: 'Até 5.000 habitantes',
    economia: 'Mercado com lojas e oficinas. Itens de até T$ 1.000; os raros (armas exóticas, armas de fogo, alquímicos) existem em 2d6 exemplares ou não existem. Caixa de 1d6 × T$ 1.000.',
    interpretacao: 'Encomendas: itens comuns de até T$ 1.000, sem limite. Gerar estoque: cada item raro tem 50% de chance de existir e, se existir, vem em 2d6 unidades.',
    catalogo: { ativo: true, precoMax: 1000, excluirRaros: true, magias: false },
    gerar: { precoMax: 1000, comuns: null, sortimento: 100, raros: '2d6', chanceRaro: 50, valiosos: null },
    caixa: { formula: '1d6 * 1000', ilimitado: false },
    superiores: false,
  },
  cidade: {
    rotulo: 'Cidade',
    icone: 'fa-chess-rook',
    populacao: 'Até 25.000 habitantes',
    economia: 'Praticamente qualquer item mundano. Itens acima de T$ 10.000 podem não estar disponíveis. Caixa de 2d4 × T$ 10.000.',
    interpretacao: 'Encomendas: tudo até T$ 10.000, sem limite, mais itens superiores. Gerar estoque: 1d6 itens acima de T$ 10.000, uma unidade de cada.',
    catalogo: { ativo: true, precoMax: 10000, excluirRaros: false, magias: false },
    gerar: { precoMax: null, comuns: null, sortimento: 0, raros: null, valiosos: { quantos: '1d6', acimaDe: 10000 } },
    caixa: { formula: '2d4 * 10000', ilimitado: false },
    superiores: true,
  },
  metropole: {
    rotulo: 'Metrópole',
    icone: 'fa-crown',
    populacao: 'Por volta de 100 mil habitantes',
    economia: 'Tudo que pode ser imaginado, e o que falta nas lojas respeitáveis está no mercado clandestino. Até itens mágicos, em leilões exclusivos. Dinheiro virtualmente ilimitado.',
    interpretacao: 'Encomendas: o catálogo inteiro, sem limite, com poções, pergaminhos e itens superiores. Gerar estoque: 2d6+2 itens acima de T$ 10.000 (os leilões), uma unidade de cada.',
    catalogo: { ativo: true, precoMax: null, excluirRaros: false, magias: true },
    gerar: { precoMax: null, comuns: null, sortimento: 0, raros: null, valiosos: { quantos: '2d6+2', acimaDe: 10000 } },
    caixa: { formula: null, ilimitado: true },
    superiores: true,
  },
};

/** Configuração inicial de um mercador recém-criado. */
export function configPadrao(comunidade = 'vila') {
  const c = COMUNIDADES[comunidade] ?? COMUNIDADES.vila;
  return {
    ativo: true,
    comunidade,
    sempreAMostra: false, // aparece no seletor da loja mesmo fora da cena
    catalogo: { ...c.catalogo },
    caixaIlimitado: c.caixa.ilimitado,
    precoCompra: 100,   // % do preço que o jogador paga
    precoVenda: 50,     // % do valor que o mercador paga pelo item do jogador
    aceitaVenda: true,
    superiores: c.superiores,
  };
}

export function ehMercador(ator) {
  return ator?.type === TIPO_MERCADOR;
}

/**
 * Configuração do mercador (gravada no ator, completada com o padrão), ou
 * null se o ator não for um Mercador. Vale também com a loja fechada.
 */
export function configMercador(ator) {
  if (!ehMercador(ator)) return null;
  const bruto = ator.getFlag(MODULE_ID, FLAG) ?? {};
  const base = configPadrao(bruto.comunidade in COMUNIDADES ? bruto.comunidade : 'vila');
  return foundry.utils.mergeObject(base, bruto, { inplace: false });
}

/** Configuração do mercador só se a loja dele estiver aberta. */
export function lojaAberta(ator) {
  const cfg = configMercador(ator);
  return cfg?.ativo ? cfg : null;
}

/** Ids dos atores com token na cena que o usuário vê e na cena ativa. */
function atoresNasCenas() {
  const ids = new Set();
  for (const cena of new Set([canvas?.scene, game.scenes?.active].filter(Boolean))) {
    for (const t of cena.tokens) if (t.actorId) ids.add(t.actorId);
  }
  return ids;
}

/**
 * Mercadores que aparecem no seletor da loja: os com token na cena (a
 * que o usuário vê ou a ativa) e os marcados "Loja sempre à mostra". O
 * mestre vê todos os de loja aberta. Os da cena vêm primeiro.
 */
export function mercadoresDisponiveis() {
  const naCena = atoresNasCenas();
  return game.actors
    .filter(a => {
      const cfg = lojaAberta(a);
      return cfg && (game.user.isGM || cfg.sempreAMostra || naCena.has(a.id));
    })
    .map(a => ({ ator: a, naCena: naCena.has(a.id), sempreAMostra: !!configMercador(a).sempreAMostra }))
    .sort((x, y) => (y.naCena - x.naCena) || x.ator.name.localeCompare(y.ator.name, 'pt-BR'));
}

/** Mercador do token que o usuário está mirando (atalho para abrir a loja nele). */
export function mercadorMirado() {
  for (const t of game.user?.targets ?? []) {
    const ator = t.actor?.isToken ? game.actors.get(t.document.actorId) : t.actor;
    if (lojaAberta(ator)) return ator;
  }
  return null;
}

/* ─────────────────────────────────────────────
   Estoque
───────────────────────────────────────────── */

/** Tipos de item que um mercador vende (os mesmos que um personagem vende). */
export const TIPOS_ESTOQUE = new Set(['arma', 'equipamento', 'consumivel', 'tesouro']);

export function itemIlimitado(item) {
  return !!item?.getFlag?.(MODULE_ID, 'ilimitado');
}

/** Quantas peças há na prateleira. Item sem campo de quantidade conta como 1. */
export function qtdEmEstoque(item) {
  if (itemIlimitado(item)) return Infinity;
  const q = item?.system?.qtd;
  if (q === undefined || q === null || q === '') return 1;
  return Math.max(0, Math.floor(Number(q) || 0));
}

const normalizar = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Fonte original de uma peça (compêndio/mundo de onde ela veio). */
export function origemDaPeca(item) {
  return item.getFlag?.(MODULE_ID, 'sourceUuid') ?? item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? null;
}

/**
 * Devolve uma função que dá o preço de tabela de uma peça do estoque.
 * Uma peça sem preço (por exemplo, um item do mundo criado sem preço e
 * arrastado para o mercador) usa o preço da mesma peça no catálogo da
 * loja: pela origem, senão pelo nome. Sem isso, a peça sumia da vitrine
 * sem aviso nenhum.
 * @param {object[]} catalogo  itens da loja (formatItem de shop-app)
 */
export function precoDaPeca(catalogo = []) {
  const porUuid = new Map(), porNome = new Map();
  for (const c of catalogo) {
    if (c.isSpell || !(c.preco > 0)) continue;
    porUuid.set(c.uuid, c.preco);
    const n = normalizar(c.name);
    if (!porNome.has(n)) porNome.set(n, c.preco);
  }
  return item => {
    const proprio = Number(item.system?.preco);
    if (proprio > 0) return proprio;
    return porUuid.get(origemDaPeca(item)) ?? porNome.get(normalizar(item.name)) ?? 0;
  };
}

/** Itens do inventário do mercador com pelo menos uma peça. */
export function itensDoEstoque(ator) {
  return ator.items.filter(i => TIPOS_ESTOQUE.has(i.type) && qtdEmEstoque(i) > 0);
}

/** Item raro pelas regras da vila: armas exóticas e de fogo, itens alquímicos. */
export function ehRaro(filterTags = []) {
  return filterTags.some(t => t === 'prof:exotica' || t === 'prof:fogo' || t === 'cons:alchemy');
}

/** O item do catálogo geral entra no catálogo deste mercador? */
export function noCatalogo(cfg, shopItem) {
  const cat = cfg?.catalogo;
  if (!cat?.ativo) return false;
  if (shopItem.isSpell) return !!cat.magias;
  const teto = Number(cat.precoMax);
  if (cat.precoMax !== null && cat.precoMax !== '' && Number.isFinite(teto) && teto > 0 && shopItem.preco > teto) return false;
  if (cat.excluirRaros && ehRaro(shopItem.filterTags)) return false;
  return true;
}

/** Moedas do ator em cobre (1 TO = 100, 1 TP = 10, 1 TC = 1). */
export function caixaEmCobre(ator) {
  const d = ator?.system?.dinheiro ?? {};
  return Math.round((Number(d.to) || 0) * 100 + (Number(d.tp) || 0) * 10 + (Number(d.tc) || 0));
}

/** Chave para empilhar itens iguais no inventário do mercador. */
function mesmaPeca(item, dados) {
  if (item.type !== dados.type || item.name !== dados.name) return false;
  if (item.getFlag(MODULE_ID, 'aprimoramentos') || dados.flags?.[MODULE_ID]?.aprimoramentos) return false;
  return true;
}

/* ─────────────────────────────────────────────
   Operações no mercador (rodam no mestre)
───────────────────────────────────────────── */

/** Dinheiro do mercador depois de somar/subtrair `deltaCobre`, sem reorganizar o resto. */
function moedasComDelta(ator, deltaCobre) {
  const d = ator.system?.dinheiro ?? {};
  let to = Number(d.to) || 0, tp = Number(d.tp) || 0, tc = Number(d.tc) || 0;
  if (deltaCobre >= 0) {
    // Recebe em espécie: ouro do que fecha centena, o resto em prata e cobre.
    to += Math.floor(deltaCobre / 100);
    const resto = deltaCobre % 100;
    tp += Math.floor(resto / 10);
    tc += resto % 10;
    return { to, tp, tc };
  }
  // Paga: o total cai e as moedas são redistribuídas no mínimo de peças.
  const total = Math.max(0, to * 100 + tp * 10 + tc + deltaCobre);
  return { to: Math.floor(total / 100), tp: Math.floor((total % 100) / 10), tc: total % 10 };
}

const OPERACOES = {
  /**
   * O personagem compra: tira `linhas` do estoque e o mercador recebe `cobre`.
   * Tudo ou nada: se faltar uma peça, nada muda.
   */
  async vender({ mercadorId, linhas = [], cobre = 0 }) {
    const ator = game.actors.get(mercadorId);
    const cfg = configMercador(ator);
    if (!cfg) return { ok: false, erro: 'Este mercador não está mais aberto.' };

    const updates = [], apagar = [];
    for (const { itemId, qty } of linhas) {
      const item = ator.items.get(itemId);
      if (!item) return { ok: false, erro: 'Um dos itens já não está no estoque do mercador.' };
      if (itemIlimitado(item)) continue;
      const tem = qtdEmEstoque(item);
      if (!Number.isInteger(qty) || qty < 1) return { ok: false, erro: 'Quantidade inválida.' };
      if (tem < qty) {
        return { ok: false, erro: `${ator.name} só tem ${tem} × ${item.name}.` };
      }
      if (tem === qty) apagar.push(item.id);
      else updates.push({ _id: item.id, 'system.qtd': tem - qty });
    }
    if (updates.length) await ator.updateEmbeddedDocuments('Item', updates);
    if (apagar.length) await ator.deleteEmbeddedDocuments('Item', apagar);
    if (cobre > 0 && !cfg.caixaIlimitado) {
      const m = moedasComDelta(ator, cobre);
      await ator.update({ 'system.dinheiro.to': m.to, 'system.dinheiro.tp': m.tp, 'system.dinheiro.tc': m.tc }, { t20lojaInterno: true });
    }
    return { ok: true };
  },

  /** O personagem vende: o mercador paga `cobre` e guarda `itemData` no estoque. */
  async comprar({ mercadorId, itemData, cobre = 0 }) {
    const ator = game.actors.get(mercadorId);
    const cfg = configMercador(ator);
    if (!cfg) return { ok: false, erro: 'Este mercador não está mais aberto.' };
    if (!cfg.aceitaVenda) return { ok: false, erro: `${ator.name} não compra itens.` };
    if (!cfg.caixaIlimitado && caixaEmCobre(ator) < cobre) {
      return { ok: false, erro: `${ator.name} não tem dinheiro para pagar por isso.` };
    }

    const qty = Number(itemData?.system?.qtd) || 1;
    const igual = ator.items.find(i => mesmaPeca(i, itemData));
    if (igual) {
      if (!itemIlimitado(igual)) await igual.update({ 'system.qtd': (Number(igual.system.qtd) || 0) + qty });
    } else if (itemData) {
      const dados = foundry.utils.deepClone(itemData);
      delete dados._id;
      // Equipado na ficha do personagem não faz sentido na prateleira.
      if (dados.system && 'equipado' in dados.system && typeof dados.system.equipado !== 'object') dados.system.equipado = false;
      await ator.createEmbeddedDocuments('Item', [dados]);
    }
    if (cobre > 0 && !cfg.caixaIlimitado) {
      const m = moedasComDelta(ator, -cobre);
      await ator.update({ 'system.dinheiro.to': m.to, 'system.dinheiro.tp': m.tp, 'system.dinheiro.tc': m.tc }, { t20lojaInterno: true });
    }
    return { ok: true };
  },
};

/* Fila: duas compras simultâneas do mesmo item não podem ler o mesmo estoque. */
let fila = Promise.resolve();
function executar(op, dados) {
  const fn = OPERACOES[op];
  if (!fn) return Promise.resolve({ ok: false, erro: `Operação desconhecida: ${op}` });
  const proxima = fila.then(() => fn(dados)).catch(err => {
    console.error(`${MODULE_ID} | Falha na operação de mercador "${op}"`, err);
    return { ok: false, erro: 'O mestre não conseguiu concluir o negócio (veja o console).' };
  });
  fila = proxima.then(() => {}, () => {});
  return proxima;
}

// Função, não constante: main.js ainda não terminou de carregar quando este arquivo é avaliado.
const canal = () => `module.${MODULE_ID}`;
const pendentes = new Map();

/** Liga o socket. Chamado no ready. */
export function registrarSocketMercador() {
  game.socket.on(canal(), async msg => {
    if (msg?.tipo === 'resposta') {
      if (msg.para !== game.user.id) return;
      pendentes.get(msg.id)?.(msg.resultado);
      return;
    }
    if (msg?.tipo !== 'pedido') return;
    // Só um mestre responde: o "ativo" que o próprio Foundry elege.
    if (game.users.activeGM?.id !== game.user.id) return;
    const resultado = await executar(msg.op, msg.dados);
    game.socket.emit(canal(), { tipo: 'resposta', id: msg.id, para: msg.de, resultado });
  });
}

/**
 * Pede uma operação no mercador. Quem pode editar o ator (o mestre) executa
 * direto; os outros pedem ao mestre ativo e esperam a resposta.
 * @returns {Promise<{ok:boolean, erro?:string}>}
 */
export function pedirAoMercador(op, dados) {
  const gm = game.users.activeGM;
  // Uma fila só, no mestre ativo: duas compras ao mesmo tempo (de jogadores,
  // ou de dois mestres) nunca leem o mesmo estoque.
  if (gm?.isSelf) return executar(op, dados);
  if (!gm) {
    const ator = game.actors.get(dados.mercadorId);
    if (ator?.isOwner) return executar(op, dados);
    return Promise.resolve({ ok: false, erro: 'Nenhum mestre conectado: o mercador só negocia com o mestre na mesa.' });
  }
  return new Promise(resolve => {
    const id = foundry.utils.randomID();
    const limite = setTimeout(() => {
      pendentes.delete(id);
      resolve({ ok: false, erro: 'O mestre não respondeu a tempo. Tente de novo.' });
    }, 30000);
    pendentes.set(id, resultado => {
      clearTimeout(limite);
      pendentes.delete(id);
      resolve(resultado ?? { ok: false, erro: 'Resposta vazia do mestre.' });
    });
    game.socket.emit(canal(), { tipo: 'pedido', id, de: game.user.id, op, dados });
  });
}

/* ─────────────────────────────────────────────
   Geração de estoque (Livro Básico, p. 271)
───────────────────────────────────────────── */

async function rolar(formula) {
  const r = await new Roll(formula).evaluate();
  return { total: Math.max(0, Math.floor(r.total)), texto: `${formula} = ${r.total}`, roll: r };
}

function sortear(lista, n) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}

/**
 * Rola estoque e caixa conforme a comunidade e grava no ator.
 * @param {Actor} ator
 * @param {object[]} catalogoGeral  itens da loja (formatItem de shop-app)
 * @param {{substituir:boolean, comunidade:string, sortimento?:number, rolarCaixa:boolean}} opcoes
 * @returns {Promise<{adicionados:number, linhas:string[], caixa:string|null}>}
 */
export async function gerarEstoque(ator, catalogoGeral, { substituir = true, comunidade, sortimento, rolarCaixa = true } = {}) {
  const def = COMUNIDADES[comunidade];
  if (!def) throw new Error(`Comunidade desconhecida: ${comunidade}`);
  const regra = def.gerar;
  const fisicos = catalogoGeral.filter(i => !i.isSpell && i.preco > 0);
  const resumo = [];
  const escolhidos = []; // { shopItem, qtd, rotulo }

  // Comuns com quantidade limitada (aldeia): parte do catálogo até o teto.
  if (regra.comuns) {
    const elegiveis = fisicos.filter(i => i.preco <= regra.precoMax);
    const pct = Math.min(100, Math.max(1, Number(sortimento ?? regra.sortimento) || regra.sortimento));
    const n = Math.max(1, Math.round(elegiveis.length * pct / 100));
    for (const shopItem of sortear(elegiveis, n)) {
      const { total } = await rolar(regra.comuns);
      if (total > 0) escolhidos.push({ shopItem, qtd: total });
    }
    resumo.push(`${escolhidos.length} itens de até T$ ${regra.precoMax}, ${regra.comuns} de cada`);
  }

  // Raros (vila): cada um existe em 2d6 exemplares... ou não existe.
  if (regra.raros) {
    const raros = fisicos.filter(i => i.preco <= regra.precoMax && ehRaro(i.filterTags));
    let presentes = 0;
    for (const shopItem of raros) {
      if (Math.random() * 100 >= regra.chanceRaro) continue;
      const { total } = await rolar(regra.raros);
      if (total > 0) { escolhidos.push({ shopItem, qtd: total }); presentes++; }
    }
    resumo.push(`${presentes} de ${raros.length} itens raros, ${regra.raros} de cada`);
  }

  // Valiosos (cidade, metrópole): poucas peças únicas acima do teto.
  if (regra.valiosos) {
    const caros = fisicos.filter(i => i.preco > regra.valiosos.acimaDe);
    const { total, texto } = await rolar(regra.valiosos.quantos);
    const pegos = sortear(caros, total);
    for (const shopItem of pegos) escolhidos.push({ shopItem, qtd: 1 });
    resumo.push(`${pegos.length} peça(s) acima de T$ ${regra.valiosos.acimaDe.toLocaleString('pt-BR')} (${texto})`);
  }

  // Monta os dados dos itens a partir das fontes originais.
  const docs = await Promise.all(escolhidos.map(e => fromUuid(e.shopItem.uuid).catch(() => null)));
  const novos = [];
  docs.forEach((doc, i) => {
    if (!doc) return;
    const dados = doc.toObject();
    delete dados._id;
    dados.system.qtd = escolhidos[i].qtd;
    foundry.utils.setProperty(dados, `flags.${MODULE_ID}.sourceUuid`, doc.uuid);
    novos.push(dados);
  });

  if (substituir) {
    const velhos = ator.items.filter(i => TIPOS_ESTOQUE.has(i.type)).map(i => i.id);
    if (velhos.length) await ator.deleteEmbeddedDocuments('Item', velhos);
  }
  if (novos.length) await ator.createEmbeddedDocuments('Item', novos);

  let caixa = null;
  if (rolarCaixa) {
    if (def.caixa.ilimitado) {
      caixa = 'ilimitado';
    } else {
      const { total, texto } = await rolar(def.caixa.formula);
      // O caixa vem em T$; guardamos em ouro + prata para não virar uma pilha de prata.
      await ator.update({
        'system.dinheiro.to': Math.floor(total / 10),
        'system.dinheiro.tp': total % 10,
        'system.dinheiro.tc': 0,
      }, { t20lojaInterno: true });
      caixa = `T$ ${total.toLocaleString('pt-BR')} (${texto})`;
    }
  }

  return { adicionados: novos.length, linhas: resumo, caixa };
}
