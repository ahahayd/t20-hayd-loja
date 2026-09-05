/**
 * ShopApplication — Janela principal da loja Tormenta20.
 *
 * Carrega itens de:
 *   • Itens do mundo (se habilitado)
 *   • Compêndios do sistema (se habilitado)
 *   • Compêndios configurados pelo usuário
 *   • Itens individuais por UUID
 *
 * Moedas: TC (cobre) = 0,1 TP | TP (prata, base) | TO (ouro) = 10 TP
 * Internamente tudo é convertido para cobre inteiro para evitar float.
 *   1 TC = 1 cobre | 1 TP = 10 cobre | 1 TO = 100 cobre
 */

import { MODULE_ID, aplicarTemaLoja } from './main.js';

/* ── Mapa de tipos para labels legíveis ─────── */
const TYPE_LABELS = {
  weapon     : 'Arma',
  armor      : 'Armadura',
  equipment  : 'Equipamento',
  consumable : 'Consumível',
  consumivel : 'Consumível',
  tool       : 'Ferramenta',
  loot       : 'Espólio',
  backpack   : 'Bolsa / Contêiner',
  spell      : 'Magia',
  feat       : 'Habilidade',
  class      : 'Classe',
  subclass   : 'Subclasse',
  race       : 'Raça',
  background : 'Origem',
  arma       : 'Arma',
  armadura   : 'Armadura',
  item       : 'Item',
  poder      : 'Poder',
  magia      : 'Magia',
  tormenta20weapon : 'Arma',
};

const WEAPON_PROPERTIES = ['propriedades.ada', 'propriedades.agi', 'propriedades.alo', 'propriedades.des', 'propriedades.dupla', 'propriedades.ver', 'propriedades.hib'];
const WEAPON_PURPOSES = ['corpo-a-corpo', 'corpo-a-corpo-arremesso', 'disparo', 'arremesso'];
const WEAPON_GRIPS = ['leve', 'uma', 'duas'];
const WEAPON_PROFICIENCY = ['marcial', 'simples', 'exotica', 'fogo'];

const EQUIPMENT_TYPES = ['escudo', 'leve', 'pesada', 'acessorio', 'ferramenta', 'esoterico'];
const EQUIPMENT_USAGE = ['equipado2.hand', 'equipado2.body', 'equipado2.both'];

const CONSUMABLE_TYPES = ['ammo', 'scroll', 'alchemy', 'potion', 'material', 'food'];

const SPELL_SCHOOLS = ['abj', 'adv', 'con', 'enc', 'evo', 'ilu', 'nec', 'tra'];
const SPELL_TYPE_CODES = ['arc', 'div', 'uni', 'eng', 'sim'];
const SPELL_CIRCLES = [1, 2, 3, 4, 5];

const UPGRADE_COSTS = [300, 3000, 9000, 18000];
const ENCHANT_COSTS = [18000, 36000, 72000];

/* Magias (item.type "magia" — "spell" é mantido por compatibilidade com
 * eventuais compêndios de outros sistemas/traduções). Pergaminhos e poções
 * seguem a mesma fórmula que o próprio Tormenta20 usa para criá-los a
 * partir de uma magia: T$ 30 × (custo em PM)², com o custo em PM nunca
 * menor que 1 (cobre truques de 0 PM). */
const SPELL_TYPES = ['magia', 'spell'];

function isSpellType(type) {
  return SPELL_TYPES.includes(type);
}

function typeLabel(type) {
  return TYPE_LABELS[type] ?? type ?? 'Item';
}

/** Preço (em TP) de um pergaminho/poção-base para `custoPM` PM investidos. */
function spellConsumablePrice(custoPM) {
  return 30 * Math.max(1, Number(custoPM) || 0) ** 2;
}

/**
 * Descreve, em HTML, quais aprimoramentos estruturados foram marcados no
 * diálogo de conjuração (com quantas aplicações cada, para os que podem
 * ser aplicados mais de uma vez) e o ajuste manual de custo em PM, se
 * houver. Usado para deixar isso registrado na descrição da poção.
 */
function describeAprimoramentosHtml(tempItem, configuration) {
  const aprs = configuration?.aprs ?? {};
  const effects = tempItem?.validOnUseEffects ?? [];
  const linhas = [];

  for (const [id, entry] of Object.entries(aprs)) {
    if (!entry) continue;
    const effect = effects.find(ef => ef.id === id);
    if (!effect) continue;
    if (effect.getFlag('tormenta20', 'aumenta')) {
      const qty = Number(entry.aplica) || 0;
      if (qty <= 0) continue;
      linhas.push(`${effect.name}${qty > 1 ? ` ×${qty}` : ''}`);
    } else if (entry.aplica) {
      linhas.push(effect.name);
    }
  }

  const ajuste = Number(configuration?.ajustecusto);
  if (Number.isFinite(ajuste) && ajuste !== 0) {
    linhas.push(`Ajuste manual de custo: ${ajuste > 0 ? '+' : ''}${ajuste} PM`);
  }

  if (!linhas.length) return '';
  const itens = linhas.map(l => `<li>${l}</li>`).join('');
  return `<p><strong>Aprimoramentos aplicados (comprados na loja):</strong></p><ul>${itens}</ul><hr>`;
}

/**
 * Monta os dados de um item consumível (pergaminho/poção) a partir do
 * documento da magia de origem — mesma nomenclatura e ícone que o próprio
 * Tormenta20 usa ao "Fabricar poção"/"Criar pergaminho": magias de área
 * viram "Granada de X", magias de alvo em objeto viram "Óleo de X", as
 * demais viram "Poção de X"; pergaminhos são sempre "Pergaminho de X".
 *
 * `contentDoc`, quando informado, é o item (temporário, já processado
 * pelo diálogo de conjuração) de onde vêm as rolagens — os aprimoramentos
 * escolhidos já ficam GRAVADOS no item criado (dano maior, etc.).
 * `resolvedEffects`, quando informado, é `configuration.effects` do MESMO
 * diálogo: os efeitos passivos/temporários que a magia normalmente aplica
 * ao ser conjurada (ex.: uma condição, um bônus), já reconstruídos com as
 * mudanças dos aprimoramentos marcados — exatamente o que o próprio botão
 * "Fabricar Poção" do sistema copia para a poção (`options.effects.map(e
 * => e[0])`). Sem isso, a poção perderia os efeitos que a magia deveria
 * causar ao ser usada. `sourceDoc` continua sendo a magia original, usada
 * para nome/UUID.
 */
function buildSpellConsumableData(sourceDoc, {
  forma, pm, qty, contentDoc = null, resolvedEffects = null, aprimoramentosHtml = '', configSignature = '',
}) {
  const doc = contentDoc ?? sourceDoc;
  const isPergaminho = forma === 'pergaminho';
  let subtipo = 'Pergaminho';
  let icon = 'pergaminho';
  if (!isPergaminho) {
    if (doc.system?.area) {
      subtipo = 'Granada';
      icon = 'pocao-granada';
    } else if (/objeto/i.test(doc.system?.alvo ?? '')) {
      subtipo = 'Óleo';
      icon = 'pocao-oleo';
    } else {
      subtipo = 'Poção';
      icon = 'pocao';
    }
  }

  const unitPreco = spellConsumablePrice(pm);
  const itemData = doc.toObject();
  delete itemData._id;
  delete itemData.stats;
  itemData.type = 'consumivel';
  itemData.name = `${subtipo} de ${sourceDoc.name}`;
  itemData.img = `systems/tormenta20/icons/itens/itens-magicos/${icon}.webp`;
  itemData.system.qtd = qty;
  itemData.system.espacos = 0.5;
  itemData.system.preco = unitPreco;
  itemData.system.ativacao.custo = 0;
  itemData.system.tipo = isPergaminho ? 'scroll' : 'potion';
  // Os efeitos crus do item (as escolhas de aprimoramento em si) não fazem
  // sentido num consumível pronto — trocamos pelos efeitos JÁ RESOLVIDOS
  // (passivos/temporários da magia, com os aprimoramentos aplicados), do
  // mesmo jeito que o "Fabricar Poção" nativo do sistema faz.
  if (resolvedEffects) itemData.effects = resolvedEffects.map(efs => efs[0]);
  if (aprimoramentosHtml) {
    itemData.system.description ??= {};
    itemData.system.description.value = `${aprimoramentosHtml}${itemData.system.description.value ?? ''}`;
  }

  const dedupeKey = `${sourceDoc.uuid}::${itemData.system.tipo}::${configSignature || pm}`;
  return { itemData, unitPreco, dedupeKey, subtipo };
}

function isConsumableType(type, system = {}) {
  const label = (typeLabel(type) || '').toLowerCase();
  if (label === 'consumível') return true;
  const systemType = normalizeText(system.tipo?.value ?? system.tipo);
  return CONSUMABLE_TYPES.some(code => systemType.includes(code));
}

function normalizeCodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap(normalizeCodes);
  }
  if (typeof value === 'object') {
    return normalizeCodes(value.value ?? value.id ?? value.key ?? value.codigo ?? value.slug ?? '');
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[,;|]/)
    .flatMap(part => part.trim().toLowerCase().split(/\s+/))
    .map(part => part.replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);
}

/* Collator compartilhado: localeCompare avulso reinicializa a máquina de
 * locale a cada comparação (~5-10x mais lento num sort de milhares). */
const COLLATOR = new Intl.Collator();

function normalizeText(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  }
  if (typeof value === 'object') return normalizeText(value.value ?? value.label ?? value.name ?? '');
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function getMainCategoryTag(itemType) {
  if (isSpellType(itemType)) return 'cat:magia';
  const label = (typeLabel(itemType) || '').toLowerCase();
  if (label === 'arma') return 'cat:arma';
  if (label === 'consumível') return 'cat:consumivel';
  if (label === 'espólio' || itemType === 'loot' || itemType === 'tesouro') return 'cat:tesouro';
  if (['equipamento', 'armadura', 'ferramenta', 'bolsa / contêiner'].includes(label)) {
    return 'cat:equipamento';
  }
  return null;
}

function mapWeaponPurpose(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes('corpo') && text.includes('arremesso')) return 'corpo-a-corpo-arremesso';
  if (text.includes('corpo')) return 'corpo-a-corpo';
  if (text.includes('disparo')) return 'disparo';
  if (text.includes('arremesso')) return 'arremesso';
  return WEAPON_PURPOSES.find(code => text.includes(code)) ?? null;
}

function mapEquipmentType(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes('escudo')) return 'escudo';
  if (text.includes('leve')) return 'leve';
  if (text.includes('pesada')) return 'pesada';
  if (text.includes('acess')) return 'acessorio';
  if (text.includes('ferrament')) return 'ferramenta';
  if (text.includes('esot')) return 'esoterico';
  return EQUIPMENT_TYPES.find(code => text.includes(code)) ?? null;
}

function buildFilterTags(doc) {
  const tags = new Set();
  const system = doc.system ?? {};
  const mainTag = getMainCategoryTag(doc.type);
  if (mainTag) tags.add(mainTag);

  if (mainTag === 'cat:arma') {
    const propsRaw = system.propriedades?.value ?? system.propriedades ?? system.properties?.value ?? system.properties ?? [];
    const propCodes = normalizeCodes(propsRaw).filter(code => WEAPON_PROPERTIES.includes(code));
    propCodes.forEach(code => tags.add(`prop:${code.split('.').pop()}`));

    if (system.propriedades && typeof system.propriedades === 'object') {
      WEAPON_PROPERTIES.forEach(code => {
        const key = code.split('.').pop();
        if (system.propriedades?.[key]) {
          tags.add(`prop:${key}`);
        }
      });
    }

    const purpose = mapWeaponPurpose(system.proposito?.value ?? system.proposito);
    if (purpose) tags.add(`purpose:${purpose}`);

    const gripCodes = normalizeCodes(system.empunhadura?.value ?? system.empunhadura).filter(code => WEAPON_GRIPS.includes(code));
    gripCodes.forEach(code => tags.add(`grip:${code}`));

    const profCodes = normalizeCodes(system.proficiencia?.value ?? system.proficiencia).filter(code => WEAPON_PROFICIENCY.includes(code));
    profCodes.forEach(code => tags.add(`prof:${code}`));
  }

  if (mainTag === 'cat:equipamento') {
    const equipType = mapEquipmentType(system.tipo?.value ?? system.tipo);
    if (equipType) tags.add(`equip:${equipType}`);

    const usageType = normalizeText(system.equipado2?.type ?? system.equipado?.type ?? system.equipado);
    if (['hand', 'body', 'both'].includes(usageType)) {
      tags.add(`usage:${usageType}`);
    } else {
      const usage = normalizeText(system.equipado2?.type ?? system.equipado2 ?? system.equipado?.value ?? system.equipado);
      const usageCode = EQUIPMENT_USAGE.find(code => usage.includes(code));
      if (usageCode) tags.add(`usage:${usageCode.split('.').pop()}`);
    }
  }

  if (mainTag === 'cat:consumivel') {
    const consumableType = normalizeText(system.tipo?.value ?? system.tipo);
    const consumableCode = CONSUMABLE_TYPES.find(code => consumableType.includes(code));
    if (consumableCode) tags.add(`cons:${consumableCode}`);
  }

  if (mainTag === 'cat:magia') {
    const circulo = Number(system.circulo) || 0;
    if (SPELL_CIRCLES.includes(circulo)) tags.add(`circulo:${circulo}`);

    const escola = normalizeCodes(system.escola?.value ?? system.escola)[0];
    if (escola && SPELL_SCHOOLS.includes(escola)) tags.add(`escola:${escola}`);

    const spellType = normalizeCodes(system.tipo?.value ?? system.tipo)[0];
    if (spellType && SPELL_TYPE_CODES.includes(spellType)) tags.add(`stipo:${spellType}`);
  }

  return Array.from(tags);
}

function getChatRecipients() {
  if (!game.settings.get(MODULE_ID, 'whisperChatMessages')) return null;
  return game.users.filter(user => user.isGM).map(user => user.id);
}

function calculateCartTotals(items, percent = 100) {
  const multiplier = percent / 100;
  const lines = items.map(item => {
    const unit = item.preco;
    const total = unit * item.qty * multiplier;
    return {
      ...item,
      lineTotal: total,
      lineDisplay: precoDisplay(total),
      unitDisplay: precoDisplay(unit),
    };
  });
  const total = lines.reduce((sum, item) => sum + item.lineTotal, 0);
  return { lines, total, totalDisplay: precoDisplay(total) };
}

/* ── Helpers de moeda ───────────────────────── */

/** Converte (TO, TP, TC) → inteiro em cobre (base 1). */
function toCobre(to = 0, tp = 0, tc = 0) {
  return Math.round((to * 100) + (tp * 10) + tc);
}

/** Converte inteiro de cobre de volta para (TO, TP, TC). */
function fromCobre(cobre) {
  const to = Math.floor(cobre / 100);
  const remainder = cobre % 100;
  const tp = Math.floor(remainder / 10);
  const tc = remainder % 10;
  return { to, tp, tc };
}

/* ── Troco realista ─────────────────────────────────────────────
   Com a opção "Troco realista" ligada, a loja deixa de normalizar a
   carteira: o personagem paga com as moedas que tem (das menores para
   as maiores) e recebe troco em espécie, conforme o porte da compra:
     - compra pequena (< 10 TP): troco todo em cobre (TC);
     - compra média: troco em prata e cobre (TP + TC);
     - compra a partir do limiar do mestre (padrão 1000 TP): troco em
       ouro (TO), com o resto em TP/TC.
   Desligada, vale o comportamento clássico (redistribuição ótima). */

function trocoRealistaAtivo() {
  try { return game.settings.get(MODULE_ID, 'trocoRealista'); }
  catch { return false; }
}

function limiarTrocoTOCobre() {
  try { return Math.max(0, Number(game.settings.get(MODULE_ID, 'limiarTrocoTO')) || 1000) * 10; }
  catch { return 10000; }
}

/** Distribui um valor em moedas conforme o porte da transação. */
export function distribuirMoedasRealista(valorCobre, transacaoCobre) {
  if (valorCobre <= 0) return { to: 0, tp: 0, tc: 0 };
  if (transacaoCobre >= limiarTrocoTOCobre()) return fromCobre(valorCobre);
  if (transacaoCobre < 10) return { to: 0, tp: 0, tc: valorCobre }; // compra abaixo de 1 TP: troco em cobre
  const tp = Math.floor(valorCobre / 10);
  return { to: 0, tp, tc: valorCobre - tp * 10 };
}

/**
 * Debita um custo da carteira. Retorna { to, tp, tc, troco } — `troco`
 * é null quando não houve (pagamento exato ou modo clássico).
 * Pré-condição: o chamador já validou saldo suficiente.
 */
export function debitarCarteira(wealth, costCopper) {
  if (!trocoRealistaAtivo()) {
    const r = fromCobre(toCobre(wealth.to, wealth.tp, wealth.tc) - costCopper);
    return { ...r, troco: null, pago: null };
  }

  /* Pagamento com troco MÍNIMO: enumera as poucas combinações candidatas
   * (piso/teto de cada moeda grande) e escolhe a de menor troco — no
   * empate, a que gasta menos moedas grandes. Evita o caso "entrega 2 TP
   * junto de 30 TO e recebe os mesmos 2 TP de volta". */
  const { to, tp, tc } = wealth;
  let melhor = null;
  const considerar = (usaTo, usaTp, usaTc, sobra) => {
    const trocoCobre = -sobra;
    if (melhor) {
      if (trocoCobre > melhor.trocoCobre) return;
      if (trocoCobre === melhor.trocoCobre
        && (usaTo > melhor.usaTo || (usaTo === melhor.usaTo && usaTp >= melhor.usaTp))) return;
    }
    melhor = { usaTo, usaTp, usaTc, trocoCobre };
  };

  for (const usaTo of new Set([
    Math.min(to, Math.floor(costCopper / 100)),
    Math.min(to, Math.ceil(costCopper / 100))
  ])) {
    const r1 = costCopper - usaTo * 100;
    if (r1 <= 0) { considerar(usaTo, 0, 0, r1); continue; }
    for (const usaTp of new Set([
      Math.min(tp, Math.floor(r1 / 10)),
      Math.min(tp, Math.ceil(r1 / 10))
    ])) {
      const r2 = r1 - usaTp * 10;
      if (r2 <= 0) { considerar(usaTo, usaTp, 0, r2); continue; }
      const usaTc = Math.min(tc, r2);
      if (r2 - usaTc <= 0) considerar(usaTo, usaTp, usaTc, r2 - usaTc);
    }
  }

  // Rede de segurança (não deve ocorrer com saldo suficiente): greedy antigo
  if (!melhor) {
    let resto = costCopper;
    const usaTc = Math.min(tc, resto); resto -= usaTc;
    const usaTp = Math.min(tp, Math.ceil(Math.max(0, resto) / 10)); resto -= usaTp * 10;
    let usaTo = 0;
    if (resto > 0) { usaTo = Math.min(to, Math.ceil(resto / 100)); resto -= usaTo * 100; }
    melhor = { usaTo, usaTp, usaTc, trocoCobre: Math.max(0, -resto) };
  }

  const troco = distribuirMoedasRealista(melhor.trocoCobre, costCopper);
  return {
    to: to - melhor.usaTo + troco.to,
    tp: tp - melhor.usaTp + troco.tp,
    tc: tc - melhor.usaTc + troco.tc,
    troco: melhor.trocoCobre > 0 ? troco : null,
    // Moedas efetivamente entregues ao mercador (para o card do chat)
    pago: { to: melhor.usaTo, tp: melhor.usaTp, tc: melhor.usaTc }
  };
}

/** Linha "Pago" dos cards: as moedas entregues, como deltas negativos. */
function linhaPagamento(pago) {
  if (!pago || (pago.to === 0 && pago.tp === 0 && pago.tc === 0)) return '';
  return linhaCartao('Pago', moedasChips({ to: -pago.to, tp: -pago.tp, tc: -pago.tc }, { delta: true }));
}

/** Credita um ganho (venda) na carteira, em espécie no modo realista. */
export function creditarCarteira(wealth, ganhoCobre) {
  if (!trocoRealistaAtivo()) {
    return fromCobre(toCobre(wealth.to, wealth.tp, wealth.tc) + ganhoCobre);
  }
  const pago = distribuirMoedasRealista(ganhoCobre, ganhoCobre);
  return { to: wealth.to + pago.to, tp: wealth.tp + pago.tp, tc: wealth.tc + pago.tc };
}

/* ── Cartões de chat (visual premium) ───────────────────────────
   HTML puro + CSS — custo idêntico às mensagens antigas. A classe
   t20-loja-message é preservada: o t20-hayd-management a usa para
   suprimir estes cartões durante transferências de party. */

/**
 * Chips de moedas: [12 TO] [3 TP] [5 TC].
 * Com delta, o chip mantém o FUNDO da moeda e o texto fica verde
 * (aumento) ou vermelho (diminuição).
 * TL (platina) só aparece quando a regra opcional está habilitada para o
 * ator (`mostrarTl`) — ou quando o delta de TL é diferente de zero.
 */
export function moedasChips(moedas, { delta = false, ocultarZeros = true, mostrarTl = false } = {}) {
  const defs = [['tl', 'TL'], ['to', 'TO'], ['tp', 'TP'], ['tc', 'TC']];
  const chips = [];
  for (const [k, rotulo] of defs) {
    const v = Number(moedas?.[k]) || 0;
    if (k === 'tl' && !mostrarTl && v === 0) continue;
    if (v === 0 && (ocultarZeros || delta)) continue;
    const sinal = delta ? (v > 0 ? 'pos' : 'neg') : '';
    const texto = delta && v > 0 ? `+${v}` : `${v}`;
    chips.push(`<span class="t20l-coin t20l-${k} ${sinal ? `t20l-${sinal}` : ''}">${texto}<i>${rotulo}</i></span>`);
  }
  return chips.length ? chips.join('') : `<span class="t20l-coin t20l-vazio">—</span>`;
}

/** Cartão padrão da loja para o chat. */
export function cartaoLoja({ icone, titulo, ator, corpo, saldo, mostrarTl = false }) {
  return `
    <div class="t20-loja-message t20l-card">
      <div class="t20l-head">
        <i class="fas ${icone}"></i>
        <div><strong>${ator}</strong><span>${titulo}</span></div>
      </div>
      <div class="t20l-body">${corpo}</div>
      ${saldo ? `<div class="t20l-saldo"><span>Saldo</span>${moedasChips(saldo, { ocultarZeros: false, mostrarTl })}</div>` : ''}
    </div>`;
}

/** A regra opcional de Tibar de Platina está ativa para este ator? */
export function atorUsaPlatina(actor) {
  return !!actor?.getFlag?.('tormenta20', 'sheet.mostrarPlatina');
}

/** Linha rótulo/valor do corpo do cartão. */
export function linhaCartao(rotulo, valorHtml) {
  return `<div class="t20l-row"><span>${rotulo}</span><div>${valorHtml}</div></div>`;
}

/** Retorna texto legível para um preço em prata (TP). */
function precoDisplay(silverPrice) {
  if (silverPrice === 0) return 'Grátis';
  // Formata para ter no máximo 1 casa decimal, se necessário.
  const formattedPrice = Number(silverPrice.toFixed(1));
  return `${formattedPrice} TP`;
}

/* ─────────────────────────────────────────────────────────────
   Cache compartilhado de itens
   ─────────────────────────────────────────────────────────────
   Carregar os compêndios (pack.getDocuments) é a operação cara.
   Em vez de refazer isso a cada abertura da loja, formatamos os
   itens uma única vez e reutilizamos o resultado em todas as
   janelas. O cache é pré-aquecido no boot do Foundry (hook ready)
   e invalidado automaticamente quando as fontes mudam.
───────────────────────────────────────────────────────────── */
const ItemCache = {
  /** @type {ShopItem[]|null} Itens já formatados (null = não carregado) */
  items      : null,
  /** Fingerprint das settings que definem o conteúdo da loja */
  fingerprint: null,
  /** @type {Promise<ShopItem[]>|null} Build em andamento */
  building   : null,
};

/** Identifica as configurações que afetam o conteúdo da loja. */
function shopSettingsFingerprint() {
  return JSON.stringify({
    world : game.settings.get(MODULE_ID, 'includeWorldItems'),
    system: game.settings.get(MODULE_ID, 'includeSystemPacks'),
    packs : game.settings.get(MODULE_ID, 'extraCompendiums') || [],
    items : game.settings.get(MODULE_ID, 'extraItems') || [],
  });
}

/** Indica se há um cache válido pronto para uso imediato. */
export function shopItemsCacheReady() {
  return !!ItemCache.items && ItemCache.fingerprint === shopSettingsFingerprint();
}

/** Formata um documento Item para o formato interno da loja. */
function formatItem(doc) {
  const isSpell = isSpellType(doc.type);
  const espacosBase = Number(doc.system?.espacos) || 0;
  const qtd = Number(doc.system?.qtd) || 1;
  const espacos = espacosBase * qtd;
  const filterTags = buildFilterTags(doc);
  const label = typeLabel(doc.type);

  let preco, precoDisplayText, spellCirculo = null, spellCustoPM = null;
  if (isSpell) {
    spellCirculo = Number(doc.system?.circulo) || 0;
    spellCustoPM = Math.max(1, Number(doc.system?.ativacao?.custo) || 0);
    preco = spellConsumablePrice(spellCustoPM);
    precoDisplayText = `A partir de ${precoDisplay(preco)}`;
  } else {
    preco = Number(doc.system?.preco) || 0;
    precoDisplayText = precoDisplay(preco);
  }

  return {
    uuid        : doc.uuid,
    name        : doc.name,
    img         : doc.img ?? 'icons/svg/item-bag.svg',
    type        : doc.type,
    typeLabel   : label,
    preco,
    precoDisplay: precoDisplayText,
    espacos,
    filterTags,
    source      : doc.system?.source ?? '',
    isSpell,
    spellCirculo,
    spellCustoPM,
    // Busca pré-normalizada UMA vez na construção do cache — antes o
    // NFD+regex rodava sobre milhares de nomes a cada tecla digitada
    searchName  : normalizeText(doc.name),
    searchType  : normalizeText(label),
  };
}

/** Carrega e formata todos os itens das fontes configuradas. */
async function buildShopItems() {
  const items = [];
  const seen  = new Set();   // evita duplicatas por UUID

  const addItem = (doc) => {
    if (!doc) return;
    if (!isSpellType(doc.type)) {
      const preco = doc.system?.preco;
      if (preco === undefined || preco === null || preco === '' || Number(preco) <= 0) return;
    }
    const uuid = doc.uuid ?? doc.id;
    if (seen.has(uuid)) return;
    seen.add(uuid);
    items.push(formatItem(doc));
  };

  // 1. Itens do mundo (já estão em memória)
  if (game.settings.get(MODULE_ID, 'includeWorldItems')) {
    for (const item of game.items) addItem(item);
  }

  // 2 + 3. Compêndios do sistema e configurados — carregados em paralelo
  const packs = [];
  if (game.settings.get(MODULE_ID, 'includeSystemPacks')) {
    for (const pack of game.packs) {
      if (pack.documentName === 'Item' &&
          (pack.metadata.packageType === 'system' || pack.metadata.packageName === game.system.id)) {
        packs.push(pack);
      }
    }
  }
  const extraPacks = game.settings.get(MODULE_ID, 'extraCompendiums') || [];
  for (const packId of extraPacks) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== 'Item') {
      console.warn(`${MODULE_ID} | Compêndio inválido ou não é de Itens: ${packId}`);
      continue;
    }
    if (!packs.includes(pack)) packs.push(pack);
  }

  const packResults = await Promise.all(packs.map(async pack => {
    try {
      return await pack.getDocuments();
    } catch (e) {
      console.warn(`${MODULE_ID} | Erro ao carregar compêndio ${pack.collection}`, e);
      return [];
    }
  }));
  for (const docs of packResults) {
    for (const doc of docs) addItem(doc);
  }

  // 4. Itens individuais por UUID — também em paralelo
  const extraItems = game.settings.get(MODULE_ID, 'extraItems') || [];
  const extraDocs = await Promise.all(extraItems.map(async uuid => {
    try {
      return await fromUuid(uuid);
    } catch (e) {
      console.warn(`${MODULE_ID} | UUID inválido: ${uuid}`, e);
      return null;
    }
  }));
  for (const doc of extraDocs) addItem(doc);

  return items;
}

/**
 * Retorna os itens da loja, usando o cache quando possível.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<ShopItem[]>}
 */
export async function getShopItems({ force = false } = {}) {
  const fingerprint = shopSettingsFingerprint();

  if (!force && ItemCache.items && ItemCache.fingerprint === fingerprint) {
    return ItemCache.items;
  }
  if (ItemCache.building) return ItemCache.building;

  ItemCache.building = (async () => {
    try {
      const items = await buildShopItems();
      ItemCache.items       = items;
      ItemCache.fingerprint = fingerprint;
      return items;
    } finally {
      ItemCache.building = null;
    }
  })();

  return ItemCache.building;
}

/** Invalida o cache, forçando recarga na próxima requisição. */
export function invalidateShopItemsCache() {
  ItemCache.items       = null;
  ItemCache.fingerprint = null;
}

/**
 * Pré-aquece o cache (chamado no boot e após mudanças de fonte) para
 * que a primeira abertura da loja seja instantânea.
 */
export async function warmShopItemsCache() {
  try {
    await getShopItems({ force: true });
  } catch (e) {
    console.warn(`${MODULE_ID} | Falha ao pré-carregar itens da loja`, e);
  }
}

/* ─────────────────────────────────────────────────────────────
   ShopApplication
───────────────────────────────────────────────────────────── */
export class ShopApplication extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor   = actor;
    /** @type {ShopItem[]} Todos os itens disponíveis (carregados uma vez por sessão de janela) */
    this._allItems   = [];
    /** @type {boolean} Indica se itens já foram carregados */
    this._loaded     = false;
    /** @type {boolean} Está carregando */
    this._loading    = false;
    /** Estado de filtros */
    this._search     = '';
  this._searchFocused = false;
    this._typeFilter = 'all';
    this._sortBy     = 'name';
    this._mode       = 'buy';
    this._sellPercent = 50;
    this._buyPercent = 100;
    this._affordableOnly = true;
    this._hideSpells = false;
    this._filterTags = new Set();
    this._filterMatch = 'any';
    this._openFilterGroups = new Set();
    this._sideFilterScroll = 0;
    this._cartItems = new Map();
    this._cartApp = null;
    /** @type {number|null} Timer de debounce da busca */
    this._searchTimer = null;

    this._actorUpdateHook = Hooks.on('updateActor', (updatedActor, data) => {
      if (!this.rendered) return;
      if (updatedActor?.id !== this.actor?.id) return;
      if (!data?.system?.dinheiro) return;
      this.render();
    });
  }

  async close(options = {}) {
    if (this._actorUpdateHook) {
      Hooks.off('updateActor', this._actorUpdateHook);
      this._actorUpdateHook = null;
    }
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    return super.close(options);
  }

  /** Agenda um re-render da busca, agrupando teclas digitadas em sequência. */
  _scheduleSearchRender() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.render();
    }, 180);
  }

  /* ── defaultOptions ─────────────────────────── */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id        : `t20-loja-${foundry.utils.randomID(4)}`,
      title     : 'Loja',
      template: `modules/t20-hayd-loja/templates/shop.hbs`,
  width     : 900,
      height    : 620,
      resizable : true,
      classes   : ['t20-loja-window'],
      scrollY   : ['.shop-items-list'],
    });
  }

  /* ── getData ────────────────────────────────── */
  async getData() {
    // Carrega itens na primeira vez (ou se ainda não carregou)
    if (!this._loaded && !this._loading) {
      await this._loadAllItems();
    }

    const wealth    = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    const isSellMode = this._mode === 'sell';

    /* Só o pipeline do modo ATIVO roda — antes compra e venda eram
     * computadas (filtro + sort + clone de milhares de itens) em todo
     * render, e metade era descartada. */
    let items, totalItems;
    if (isSellMode) {
      const sellFiltered = this._applyFilters(this._getSellItems());
      items = this._applySort(sellFiltered).map(item => ({
        ...item,
        sellPriceDisplay: precoDisplay(item.sellPrice),
      }));
      totalItems = sellFiltered.length;
    } else {
      // Lista pré-ordenada + filtro (ordem preservada) = mesmo resultado
      let filtered = this._applyFilters(this._getSortedAll());
      if (this._hideSpells) filtered = filtered.filter(item => !item.isSpell);
      // O contador sempre reflete o filtro de busca/tipo/tags/magias (como
      // antes, sem considerar o "posso pagar")
      totalItems = filtered.length;
      // Percentual de preço do modo compra (desconto/acréscimo do mestre)
      const fator = this._buyPercent / 100;
      const custoCobre = item => Math.round(item.preco * fator * 10);
      // Com "só o que posso pagar", filtra ANTES de clonar os objetos
      const visiveis = this._affordableOnly
        ? filtered.filter(item => totalCopper >= custoCobre(item))
        : filtered;
      items = visiveis.map(item => ({
        ...item,
        canAfford : totalCopper >= custoCobre(item),
        ...(fator !== 1 && !item.isSpell ? { precoDisplay: precoDisplay(item.preco * fator) } : {}),
      }));
    }

    // Coleta tipos únicos para o filtro
    const types = [...new Set(this._allItems.map(i => i.type))]
      .sort()
      .map(t => ({ value: t, label: typeLabel(t) }));

    return {
      actor      : this.actor,
      items,
      types,
      search     : this._search,
      typeFilter : this._typeFilter,
      sortBy     : this._sortBy,
      wealth,
      loading    : this._loading,
      totalItems,
      mode       : this._mode,
      sellPercent: this._sellPercent,
      buyPercent : this._buyPercent,
      affordableOnly: this._affordableOnly,
      hideSpells : this._hideSpells,
      filterMatch: this._filterMatch,
    };
  }

  /* ── Carregamento de itens ──────────────────── */
  async _loadAllItems() {
    this._loading = true;
    this._loaded  = false;

    // Só mostra o spinner se o cache ainda não estiver pronto; com o cache
    // aquecido (pré-carregado no boot) a abertura é instantânea.
    const cacheQuente = shopItemsCacheReady();
    if (!cacheQuente) this.render();

    try {
      this._allItems = await getShopItems();
    } catch (e) {
      console.error(`${MODULE_ID} | Falha ao carregar itens da loja`, e);
      this._allItems = [];
    }

    this._loaded   = true;
    this._loading  = false;
    /* Com cache quente, quem chamou foi o getData do PRIMEIRO render, que
     * continua e desenha com os dados — o render extra daqui dobrava o
     * custo de abertura. No caminho do spinner o render final é preciso. */
    if (!cacheQuente) this.render();
  }

  _getSellItems() {
    const percent = this._sellPercent / 100;
    // Só itens físicos de inventário são vendáveis — poderes, magias,
    // classes e raças ficam de fora (na compra o filtro de preço > 0 já
    // os exclui naturalmente).
    const VENDAVEIS = new Set(['arma', 'equipamento', 'consumivel', 'tesouro']);
    return this.actor.items.filter(item => VENDAVEIS.has(item.type)).map(item => {
      const preco = Number(item.system?.preco) || 0;
      const qtd = Number(item.system?.qtd) || 1;
      const espacosBase = Number(item.system?.espacos) || 0;
      const espacos = espacosBase * qtd;
      const sellPrice = preco * qtd * percent;
  const filterTags = buildFilterTags(item);
      return {
        itemId     : item.id,
        uuid       : item.uuid,
        name       : item.name,
        img        : item.img ?? 'icons/svg/item-bag.svg',
        type       : item.type,
        typeLabel  : typeLabel(item.type),
        preco,
        qtd,
        sellPrice,
        espacos,
        filterTags,
        source     : item.system?.source ?? '',
        searchName : normalizeText(item.name),
        searchType : normalizeText(typeLabel(item.type)),
      };
    });
  }

  async _promptQuantity({ title, unitPrice, max = 999, percent = 1, label }) {
    return new Promise(resolve => {
      const content = `
        <div class="t20-loja-qty">
          <p>${label}</p>
          <div class="qty-row">
            <label>Quantidade</label>
            <input type="number" name="qty" min="1" max="${max}" value="1" />
          </div>
          <p class="qty-preview">Total: <strong>${precoDisplay(unitPrice * percent)}</strong></p>
        </div>
      `;

      const dialog = new Dialog({
        title,
        content,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Confirmar',
            callback: html => {
              const value = Number(html.find('input[name="qty"]').val()) || 1;
              resolve(Math.min(max, Math.max(1, value)));
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancelar',
            callback: () => resolve(null),
          },
        },
        default: 'confirm',
        close: () => resolve(null),
        render: html => {
          const input = html.find('input[name="qty"]');
          const preview = html.find('.qty-preview strong');
          input.on('input', ev => {
            const value = Number(ev.currentTarget.value) || 1;
            const clamped = Math.min(max, Math.max(1, value));
            ev.currentTarget.value = clamped;
            preview.text(precoDisplay(unitPrice * clamped * percent));
          });
        },
      });

      dialog.render(true);
    });
  }

  /** Escolha inicial: pergaminho (versão padrão) ou poção (com aprimoramentos). */
  async _promptSpellForm(shopItem) {
    return new Promise(resolve => {
      new Dialog({
        title: `Comprar ${shopItem.name}`,
        content: `
          <div class="t20-loja-spell-dialog">
            <p class="spell-dialog-hint">Magia de ${shopItem.spellCirculo}º círculo — custo base ${shopItem.spellCustoPM} PM.</p>
            <p>Comprar como pergaminho (versão padrão) ou poção (permite escolher aprimoramentos)?</p>
          </div>
        `,
        buttons: {
          pocao: {
            icon: '<i class="fas fa-flask"></i>',
            label: 'Poção',
            callback: () => resolve('pocao'),
          },
          pergaminho: {
            icon: '<i class="fas fa-scroll"></i>',
            label: 'Pergaminho',
            callback: () => resolve('pergaminho'),
          },
        },
        default: 'pocao',
        close: () => resolve(null),
      }).render(true);
    });
  }

  /**
   * Abre o MESMO diálogo que o sistema Tormenta20 usa para conjurar a magia
   * (`AbilityUseDialog`), sobre uma cópia temporária e não persistida do
   * item pertencente ao ator comprador — assim os aprimoramentos
   * estruturados (efeitos "ao usar") e os efeitos do próprio personagem
   * aparecem exatamente como apareceriam ao lançar a magia de verdade.
   * `applyOnUseEffects` (chamado pelo próprio diálogo) já grava os
   * aprimoramentos marcados diretamente nas rolagens do item temporário —
   * é esse item (já com tudo aplicado) que vira a poção, então usá-la
   * depois não pergunta os aprimoramentos de novo, só rola com tudo já
   * incluso.
   * @returns {Promise<{tempItem:Item, configuration:object, pm:number}|null>} null se cancelado.
   */
  async _resolveSpellAprimoramentos(sourceDoc) {
    const baseCusto = Number(sourceDoc.system?.ativacao?.custo) || 0;
    const AbilityUseDialogCls = game.tormenta20?.applications?.AbilityUseDialog;
    if (!AbilityUseDialogCls) {
      console.warn(`${MODULE_ID} | AbilityUseDialog do Tormenta20 não encontrado; usando custo base da magia.`);
      return { tempItem: null, configuration: null, pm: Math.max(1, baseCusto) };
    }

    const itemData = sourceDoc.toObject();
    delete itemData._id;
    const tempItem = new CONFIG.Item.documentClass(itemData, { parent: this.actor });

    const configuration = await AbilityUseDialogCls.create(tempItem);
    if (!configuration) return null;

    // O ajuste manual de custo (campo de texto livre, usado para
    // aprimoramentos apenas descritos no texto da magia) não é aplicado
    // pelo sistema — somamos aqui só para a precificação.
    const custoConfigurado = Number(tempItem.system?.ativacao?.custo);
    const ajuste = Number(configuration.ajustecusto);
    const total = (Number.isFinite(custoConfigurado) ? custoConfigurado : baseCusto)
      + (Number.isFinite(ajuste) ? ajuste : 0);
    return { tempItem, configuration, pm: Math.max(1, total) };
  }

  /**
   * Resolve forma (poção/pergaminho) e, no caso de poção, os
   * aprimoramentos escolhidos via `AbilityUseDialog` — a parte do fluxo
   * de compra/fabricação de magias que independe de preço/quantidade.
   * Compartilhado por `_configureSpellPurchase` (compra) e
   * `_configureSpellCraft` (fabricação).
   * @returns {Promise<{forma:string, sourceDoc:Item, pm:number, contentDoc:Item|null, resolvedEffects:any, aprimoramentosHtml:string, configSignature:string}|null>}
   */
  async _resolveSpellBase(shopItem) {
    const forma = await this._promptSpellForm(shopItem);
    if (!forma) return null;

    let sourceDoc;
    try {
      sourceDoc = await fromUuid(shopItem.uuid);
    } catch (e) {
      ui.notifications.error(`Não foi possível carregar a magia: ${shopItem.uuid}`);
      return null;
    }
    if (!sourceDoc) {
      ui.notifications.error('Magia não encontrada no compêndio.');
      return null;
    }

    let pm = shopItem.spellCustoPM;
    let contentDoc = null;
    let resolvedEffects = null;
    let aprimoramentosHtml = '';
    let configSignature = '';

    if (forma === 'pocao') {
      const resolved = await this._resolveSpellAprimoramentos(sourceDoc);
      if (!resolved) return null;
      pm = resolved.pm;
      if (resolved.tempItem) {
        contentDoc = resolved.tempItem;
        // Efeitos passivos/temporários que a magia normalmente aplica ao
        // ser conjurada (condições, bônus...), já reconstruídos com os
        // aprimoramentos marcados — mesma fonte que o "Fabricar Poção"
        // nativo do sistema usa.
        resolvedEffects = resolved.configuration?.effects ?? [];
        aprimoramentosHtml = describeAprimoramentosHtml(resolved.tempItem, resolved.configuration);
        configSignature = JSON.stringify({
          aprs: resolved.configuration?.aprs ?? {},
          ajuste: resolved.configuration?.ajustecusto ?? '',
        });
      }
    }

    return { forma, sourceDoc, pm, contentDoc, resolvedEffects, aprimoramentosHtml, configSignature };
  }

  /**
   * Fluxo completo de configuração de compra de uma magia: forma
   * (poção/pergaminho), aprimoramentos (só poção) e quantidade. Usado
   * tanto pela compra direta quanto por "adicionar ao carrinho". Já
   * devolve o `itemData` pronto para criar no ator — com os
   * aprimoramentos gravados nas rolagens (poção) e anotados na descrição.
   * @returns {Promise<{forma:string, pm:number, qty:number, unitPrice:number, itemData:object, dedupeKey:string, subtipo:string}|null>}
   */
  async _configureSpellPurchase(shopItem, { cart = false } = {}) {
    const base = await this._resolveSpellBase(shopItem);
    if (!base) return null;
    const { forma, sourceDoc, pm, contentDoc, resolvedEffects, aprimoramentosHtml, configSignature } = base;

    const unitPrice = spellConsumablePrice(pm);
    const qty = await this._promptQuantity({
      title: cart ? `Adicionar ${shopItem.name} ao carrinho` : `Comprar ${shopItem.name}`,
      unitPrice,
      max: 999,
      percent: 1,
      label: forma === 'pocao'
        ? `Selecione a quantidade de poções (${pm} PM investidos no total).`
        : 'Selecione a quantidade de pergaminhos (versão padrão da magia).',
    });
    if (!qty) return null;

    const { itemData, dedupeKey, subtipo } = buildSpellConsumableData(sourceDoc, {
      forma, pm, qty, contentDoc, resolvedEffects, aprimoramentosHtml, configSignature,
    });

    return { forma, pm, qty, unitPrice, itemData, dedupeKey, subtipo };
  }

  /**
   * Fluxo completo de FABRICAÇÃO de uma magia como poção/pergaminho: mesma
   * escolha de forma/aprimoramentos de `_configureSpellPurchase`, mas a
   * quantidade e o preço usam o diálogo de fabricação (`_promptCraft`) —
   * fração do preço base + desconto por matéria-prima —, igual ao que
   * `_craftItem` já faz para itens normais.
   * @returns {Promise<{forma:string, pm:number, qty:number, unitPrice:number, fraction:number, fractionLabel:string, materialDiscount:number, itemData:object, dedupeKey:string, subtipo:string}|null>}
   */
  async _configureSpellCraft(shopItem) {
    const base = await this._resolveSpellBase(shopItem);
    if (!base) return null;
    const { forma, sourceDoc, pm, contentDoc, resolvedEffects, aprimoramentosHtml, configSignature } = base;

    const unitPrice = spellConsumablePrice(pm);
    const craftData = await this._promptCraft({
      title: `Construir ${shopItem.name}`,
      unitPrice,
    });
    if (!craftData) return null;
    const { qty, fraction, fractionLabel, materialDiscount } = craftData;

    const { itemData, dedupeKey, subtipo } = buildSpellConsumableData(sourceDoc, {
      forma, pm, qty, contentDoc, resolvedEffects, aprimoramentosHtml, configSignature,
    });

    return { forma, pm, qty, unitPrice, fraction, fractionLabel, materialDiscount, itemData, dedupeKey, subtipo };
  }

  async _promptCraft({ title, unitPrice }) {
    return new Promise(resolve => {
      const fractions = [
        { label: '1/2', value: 1 / 2 },
        { label: '1/3', value: 1 / 3 },
        { label: '1/4', value: 1 / 4 },
        { label: '1/5', value: 1 / 5 },
      ];
      const defaultFraction = 1 / 3;
      const formatCraftCost = costCopper => {
        if (costCopper <= 0) return 'Grátis';
        if (costCopper < 10) return `${costCopper} TC`;
        return precoDisplay(costCopper / 10);
      };
      const dialog = new Dialog({
        title,
        content: `
          <div class="t20-loja-craft-dialog">
            <div class="craft-row">
              <label>Fração do preço</label>
              <select name="fraction" class="craft-fraction">
                ${fractions
                  .map(option => {
                    const selected = option.value === defaultFraction ? 'selected' : '';
                    return `<option value="${option.value}" ${selected}>${option.label}</option>`;
                  })
                  .join('')}
              </select>
            </div>
            <div class="craft-row">
              <label>Quantidade</label>
              <input type="number" name="qty" min="1" max="999" value="1" />
            </div>
            <div class="craft-row">
              <label>Desconto por matéria prima (TP)</label>
              <input type="number" name="materialDiscount" min="0" step="0.1" value="0" />
            </div>
            <div class="craft-preview">
              <div><strong>Custo por item:</strong> <span class="craft-unit-cost">${formatCraftCost(Math.max(1, Math.floor(unitPrice * defaultFraction * 10)))}</span></div>
              <div><strong>Total estimado:</strong> <span class="craft-total-cost">${formatCraftCost(Math.max(1, Math.floor(unitPrice * defaultFraction * 10)))}</span></div>
            </div>
          </div>
        `,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-hammer"></i>',
            label: 'Construir',
            callback: html => {
              const qtyInput = html.find('input[name="qty"]');
              const fractionInput = html.find('select[name="fraction"]');
              const discountInput = html.find('input[name="materialDiscount"]');
              const qty = Math.min(999, Math.max(1, Number(qtyInput.val()) || 1));
              const fraction = Number(fractionInput.val()) || defaultFraction;
              const materialDiscount = Math.max(0, Number(discountInput.val()) || 0);
              const fractionLabel = fractionInput.find('option:selected').text() || '1/3';
              resolve({ qty, fraction, fractionLabel, materialDiscount });
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancelar',
            callback: () => resolve(null),
          },
        },
        default: 'confirm',
        close: () => resolve(null),
        render: html => {
          const qtyInput = html.find('input[name="qty"]');
          const fractionInput = html.find('select[name="fraction"]');
          const discountInput = html.find('input[name="materialDiscount"]');
          const unitCostEl = html.find('.craft-unit-cost');
          const totalCostEl = html.find('.craft-total-cost');
          const updatePreview = () => {
            const qty = Math.min(999, Math.max(1, Number(qtyInput.val()) || 1));
            const fraction = Number(fractionInput.val()) || defaultFraction;
            const materialDiscount = Math.max(0, Number(discountInput.val()) || 0);
            const unitCostCopper = Math.max(1, Math.floor(unitPrice * fraction * 10));
            const totalCostCopper = Math.max(0, (unitCostCopper * qty) - Math.round(materialDiscount * 10));
            qtyInput.val(qty);
            discountInput.val(materialDiscount);
            unitCostEl.text(formatCraftCost(unitCostCopper));
            totalCostEl.text(formatCraftCost(totalCostCopper));
          };
          qtyInput.on('input', updatePreview);
          fractionInput.on('change', updatePreview);
          discountInput.on('input', updatePreview);
        },
      });

      dialog.render(true);
    });
  }

  /* ── Filtros e ordenação ────────────────────── */
  _applyFilters(items) {
    let list = items;
    if (this._search) {
      const q = normalizeText(this._search);
      list = list.filter(i =>
        (i.searchName ?? normalizeText(i.name)).includes(q) ||
        (i.searchType ?? normalizeText(i.typeLabel)).includes(q)
      );
    }
    if (this._typeFilter !== 'all') {
      list = list.filter(i => i.type === this._typeFilter);
    }

    if (this._filterTags.size > 0) {
      const selected = Array.from(this._filterTags);
      const matchAll = this._filterMatch === 'all';
      list = list.filter(item => {
        const tags = item.filterTags ?? [];
        if (matchAll) {
          return selected.every(tag => tags.includes(tag));
        }
        return selected.some(tag => tags.includes(tag));
      });
    }
    return list;
  }

  _applySort(items) {
    const copy = [...items];
    switch (this._sortBy) {
      case 'price-asc'  : return copy.sort((a, b) => a.preco - b.preco);
      case 'price-desc' : return copy.sort((a, b) => b.preco - a.preco);
      case 'type'       : return copy.sort((a, b) => COLLATOR.compare(a.typeLabel, b.typeLabel) || COLLATOR.compare(a.name, b.name));
      default           : return copy.sort((a, b) => COLLATOR.compare(a.name, b.name));
    }
  }

  /**
   * Lista completa já ordenada, cacheada por (fonte, critério). Como o
   * filtro preserva a ordem, filtrar a lista pré-ordenada equivale a
   * ordenar o resultado filtrado — sem re-ordenar milhares de itens a
   * cada tecla digitada.
   */
  _getSortedAll() {
    const c = this._sortedCache;
    if (c && c.source === this._allItems && c.key === this._sortBy) return c.items;
    const items = this._applySort(this._allItems);
    this._sortedCache = { source: this._allItems, key: this._sortBy, items };
    return items;
  }

  /* ── Riqueza do ator ─────────────────────────── */
  _wealthInfo() {
    const d = this.actor.system?.dinheiro ?? {};
    const to = Number(d.to) || 0;
    const tp = Number(d.tp) || 0;
    const tc = Number(d.tc) || 0;
    const tl = Number(d.tl) || 0;
    const totalSilver = (to * 10) + tp + (tc * 0.1);
    return { to, tp, tc, tl, totalSilver: parseFloat(totalSilver.toFixed(2)) };
  }

  /* ── Compra ──────────────────────────────────── */
  async _purchaseItem(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');

    let qty = 1;
  if (isConsumableType(shopItem.type, shopItem.system ?? {})) {
      const chosen = await this._promptQuantity({
        title: `Comprar ${shopItem.name}`,
        unitPrice: shopItem.preco,
        max: 999,
        percent: 1,
        label: 'Selecione a quantidade para compra.',
      });
      if (!chosen) return;
      qty = chosen;
    }

    const wealth      = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    const fatorPreco  = this._buyPercent / 100;
    const costCopper  = Math.round(shopItem.preco * qty * fatorPreco * 10);

    if (totalCopper < costCopper) {
      return ui.notifications.warn(
        `${this.actor.name} não tem moedas suficientes para comprar "${shopItem.name}"!`
      );
    }

    // Calcula novo saldo (troco realista quando ativado)
    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, costCopper);

    // Busca documento original para copiar dados
    let sourceDoc;
    try {
      sourceDoc = await fromUuid(uuid);
    } catch (e) {
      return ui.notifications.error(`Não foi possível carregar o item: ${uuid}`);
    }

    if (!sourceDoc) return ui.notifications.error('Item não encontrado no compêndio.');

    // Verifica se o ator já possui o item (mesma origem)
    const existing = this.actor.items.find(i => {
      const flag = i.getFlag(MODULE_ID, 'sourceUuid');
      return flag === uuid || i.name === sourceDoc.name;
    });

    if (existing && existing.system?.qtd !== undefined) {
      // Incrementa quantidade
      await existing.update({ 'system.qtd': (existing.system.qtd || 1) + qty });
    } else {
      // Cria novo item
      const itemData = sourceDoc.toObject();
      itemData.system.qtd = qty;
      const [created] = await this.actor.createEmbeddedDocuments('Item', [itemData]);
      // Marca a origem para futura detecção de duplicatas
      if (created) await created.setFlag(MODULE_ID, 'sourceUuid', uuid);
    }

    // Atualiza dinheiro
    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const messageContent = cartaoLoja({
      icone: 'fa-shopping-bag',
      titulo: this._buyPercent === 100
        ? 'comprou na loja'
        : `comprou na loja (${this._buyPercent}% do preço)`,
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${shopItem.img}" alt="" />${shopItem.name}${qty > 1 ? ` <em>×${qty}</em>` : ''}</div>
        ${linhaCartao('Preço', `<b>${precoDisplay(shopItem.preco * fatorPreco)}</b>${qty > 1 ? ` <small>cada</small>` : ''}`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  /**
   * Compra uma magia como item consumível: o comprador escolhe pergaminho
   * (versão padrão) ou poção (com aprimoramentos escolhidos no próprio
   * diálogo de conjuração do sistema), depois a quantidade — e a compra é
   * concluída como qualquer outra.
   */
  async _purchaseSpell(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');

    const config = await this._configureSpellPurchase(shopItem);
    if (!config) return;
    const { forma, pm, qty, unitPrice, itemData, dedupeKey, subtipo } = config;
    const isPergaminho = forma === 'pergaminho';

    const fatorPreco = this._buyPercent / 100;
    const costCopper = Math.round(unitPrice * qty * fatorPreco * 10);

    const wealth = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);

    if (totalCopper < costCopper) {
      return ui.notifications.warn(
        `${this.actor.name} não tem moedas suficientes para comprar "${shopItem.name}"!`
      );
    }

    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, costCopper);

    // Dedup: só empilha com um item já comprado com a MESMA configuração
    // (forma + aprimoramentos escolhidos) — uma poção com aprimoramentos
    // diferentes é um item diferente, mesmo vindo da mesma magia.
    const existing = this.actor.items.find(i => i.getFlag(MODULE_ID, 'spellDedupeKey') === dedupeKey);

    if (existing && existing.system?.qtd !== undefined) {
      await existing.update({ 'system.qtd': (existing.system.qtd || 1) + qty });
    } else {
      const [created] = await this.actor.createEmbeddedDocuments('Item', [itemData]);
      if (created) {
        await created.setFlag(MODULE_ID, 'sourceUuid', uuid);
        await created.setFlag(MODULE_ID, 'spellDedupeKey', dedupeKey);
      }
    }

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const messageContent = cartaoLoja({
      icone: isPergaminho ? 'fa-scroll' : 'fa-flask',
      titulo: this._buyPercent === 100
        ? `comprou ${subtipo.toLowerCase()} de magia na loja`
        : `comprou ${subtipo.toLowerCase()} de magia na loja (${this._buyPercent}% do preço)`,
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${itemData.img}" alt="" />${itemData.name}${qty > 1 ? ` <em>×${qty}</em>` : ''}</div>
        ${!isPergaminho ? linhaCartao('PM investido', `<b>${pm} PM</b>`) : ''}
        ${linhaCartao('Preço', `<b>${precoDisplay(unitPrice * fatorPreco)}</b>${qty > 1 ? ` <small>cada</small>` : ''}`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  async _sellItem(itemId) {
    const item = this.actor.items.get(itemId);
    if (!item) return ui.notifications.error('Item não encontrado no inventário.');

    const preco = Number(item.system?.preco) || 0;
    const qtd = Number(item.system?.qtd) || 1;
    const percent = this._sellPercent / 100;

    let sellQty = qtd;
    if (qtd > 1) {
      const chosen = await this._promptQuantity({
        title: `Vender ${item.name}`,
        unitPrice: preco,
        max: qtd,
        percent,
        label: 'Selecione a quantidade para venda.',
      });
      if (!chosen) return;
      sellQty = chosen;
    }

    const sellCopper = Math.round(preco * sellQty * percent * 10);

    const wealth = this._wealthInfo();
    // Modo realista: recebe as moedas em espécie, sem normalizar a carteira
    const { to: newTo, tp: newTp, tc: newTc } = creditarCarteira(wealth, sellCopper);

    if (sellQty >= qtd) {
      await item.delete();
    } else {
      await item.update({ 'system.qtd': qtd - sellQty });
    }

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const recebidoMoedas = trocoRealistaAtivo()
      ? distribuirMoedasRealista(sellCopper, sellCopper)
      : null;
    const messageContent = cartaoLoja({
      icone: 'fa-hand-holding-usd',
      titulo: `vendeu (${Math.round(percent * 100)}% do valor)`,
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${item.img}" alt="" />${item.name}${sellQty > 1 ? ` <em>×${sellQty}</em>` : ''}</div>
        ${linhaCartao('Recebido', recebidoMoedas
          ? moedasChips(recebidoMoedas)
          : `<b>${precoDisplay(preco * sellQty * percent)}</b>`)}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  async _addToCart(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');
    if (shopItem.isSpell) return this._addSpellToCart(uuid);

    let qty = 1;
    if (isConsumableType(shopItem.type, shopItem.system ?? {})) {
      const chosen = await this._promptQuantity({
        title: `Adicionar ${shopItem.name} ao carrinho`,
        unitPrice: shopItem.preco,
        max: 999,
        percent: 1,
        label: 'Selecione a quantidade para o carrinho.',
      });
      if (!chosen) return;
      qty = chosen;
    }

    const existing = this._cartItems.get(uuid);
    if (existing) {
      existing.qty += qty;
    } else {
      this._cartItems.set(uuid, {
        key: uuid,
        uuid,
        name: shopItem.name,
        img: shopItem.img,
        preco: shopItem.preco,
        qty,
      });
    }

    this._openCart();
  }

  /** Adiciona uma magia (poção/pergaminho já configurados) ao carrinho. */
  async _addSpellToCart(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');

    const config = await this._configureSpellPurchase(shopItem, { cart: true });
    if (!config) return;
    const { forma, pm, qty, unitPrice, itemData, dedupeKey, subtipo } = config;
    const cartKey = `spell::${dedupeKey}`;

    const existing = this._cartItems.get(cartKey);
    if (existing) {
      existing.qty += qty;
    } else {
      this._cartItems.set(cartKey, {
        key: cartKey,
        uuid,
        name: itemData.name,
        img: itemData.img,
        preco: unitPrice,
        qty,
        isSpell: true,
        spellForma: forma,
        spellPM: pm,
        spellSubtipo: subtipo,
        spellDedupeKey: dedupeKey,
        // Item já pronto (aprimoramentos gravados) — no checkout só
        // ajustamos a quantidade final antes de criar/empilhar.
        spellItemData: itemData,
      });
    }

    this._openCart();
  }

  async _craftItem(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');

    const formatCraftCost = costCopper => {
      if (costCopper <= 0) return 'Grátis';
      if (costCopper < 10) return `${costCopper} TC`;
      return precoDisplay(costCopper / 10);
    };

    const craftData = await this._promptCraft({
      title: `Construir ${shopItem.name}`,
      unitPrice: shopItem.preco,
    });
    if (!craftData) return;

    const { qty, fraction, fractionLabel, materialDiscount } = craftData;
  const unitCostCopper = Math.max(1, Math.floor(shopItem.preco * fraction * 10));
  const totalCostCopper = Math.max(0, (unitCostCopper * qty) - Math.round(materialDiscount * 10));

    const wealth = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
  const costCopper = totalCostCopper;

    if (totalCopper < costCopper) {
      return ui.notifications.warn(
        `${this.actor.name} não tem moedas suficientes para construir "${shopItem.name}"!`
      );
    }

    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, costCopper);

    let sourceDoc;
    try {
      sourceDoc = await fromUuid(uuid);
    } catch (e) {
      return ui.notifications.error(`Não foi possível carregar o item: ${uuid}`);
    }

    if (!sourceDoc) return ui.notifications.error('Item não encontrado no compêndio.');

    const existing = this.actor.items.find(i => {
      const flag = i.getFlag(MODULE_ID, 'sourceUuid');
      return flag === uuid || i.name === sourceDoc.name;
    });

    if (existing && existing.system?.qtd !== undefined) {
      await existing.update({ 'system.qtd': (existing.system.qtd || 1) + qty });
    } else {
      const itemData = sourceDoc.toObject();
      itemData.system.qtd = qty;
      const [created] = await this.actor.createEmbeddedDocuments('Item', [itemData]);
      if (created) await created.setFlag(MODULE_ID, 'sourceUuid', uuid);
    }

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const descontoCobre = Math.round(materialDiscount * 10);
    const messageContent = cartaoLoja({
      icone: 'fa-hammer',
      titulo: `construiu (${fractionLabel} do preço)`,
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${shopItem.img}" alt="" />${shopItem.name}${qty > 1 ? ` <em>×${qty}</em>` : ''}</div>
        ${linhaCartao('Custo por item', `<b>${formatCraftCost(unitCostCopper)}</b>`)}
        ${linhaCartao('Desconto matéria-prima', descontoCobre > 0
          ? `<b>${formatCraftCost(descontoCobre)}</b>`
          : `<small class="t20l-nulo">Não houve</small>`)}
        ${linhaCartao('Total pago', `<b>${formatCraftCost(totalCostCopper)}</b>`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  /**
   * Fabrica uma magia como poção/pergaminho por uma fração do preço (mais
   * desconto de matéria-prima), em vez de comprá-la pelo preço cheio —
   * equivalente ao "Construir" (`_craftItem`) dos itens normais, mas
   * passando primeiro pela escolha de forma/aprimoramentos das magias.
   */
  async _craftSpell(uuid) {
    const shopItem = this._allItems.find(i => i.uuid === uuid);
    if (!shopItem) return ui.notifications.error('Item não encontrado na loja.');

    const config = await this._configureSpellCraft(shopItem);
    if (!config) return;
    const { forma, pm, qty, unitPrice, fraction, fractionLabel, materialDiscount, itemData, dedupeKey, subtipo } = config;
    const isPergaminho = forma === 'pergaminho';

    const formatCraftCost = costCopper => {
      if (costCopper <= 0) return 'Grátis';
      if (costCopper < 10) return `${costCopper} TC`;
      return precoDisplay(costCopper / 10);
    };

    const unitCostCopper = Math.max(1, Math.floor(unitPrice * fraction * 10));
    const totalCostCopper = Math.max(0, (unitCostCopper * qty) - Math.round(materialDiscount * 10));

    const wealth = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    const costCopper = totalCostCopper;

    if (totalCopper < costCopper) {
      return ui.notifications.warn(
        `${this.actor.name} não tem moedas suficientes para construir "${shopItem.name}"!`
      );
    }

    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, costCopper);

    // Mesmo dedup por configuração (forma + aprimoramentos) usado na
    // compra — uma poção fabricada empilha com uma idêntica já comprada.
    const existing = this.actor.items.find(i => i.getFlag(MODULE_ID, 'spellDedupeKey') === dedupeKey);

    if (existing && existing.system?.qtd !== undefined) {
      await existing.update({ 'system.qtd': (existing.system.qtd || 1) + qty });
    } else {
      const [created] = await this.actor.createEmbeddedDocuments('Item', [itemData]);
      if (created) {
        await created.setFlag(MODULE_ID, 'sourceUuid', uuid);
        await created.setFlag(MODULE_ID, 'spellDedupeKey', dedupeKey);
      }
    }

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const descontoCobre = Math.round(materialDiscount * 10);
    const messageContent = cartaoLoja({
      icone: 'fa-hammer',
      titulo: `construiu ${subtipo.toLowerCase()} de magia (${fractionLabel} do preço)`,
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${itemData.img}" alt="" />${itemData.name}${qty > 1 ? ` <em>×${qty}</em>` : ''}</div>
        ${!isPergaminho ? linhaCartao('PM investido', `<b>${pm} PM</b>`) : ''}
        ${linhaCartao('Custo por item', `<b>${formatCraftCost(unitCostCopper)}</b>`)}
        ${linhaCartao('Desconto matéria-prima', descontoCobre > 0
          ? `<b>${formatCraftCost(descontoCobre)}</b>`
          : `<small class="t20l-nulo">Não houve</small>`)}
        ${linhaCartao('Total pago', `<b>${formatCraftCost(totalCostCopper)}</b>`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  async _promptUpgrade() {
    return new Promise(resolve => {
      const fractions = [
        { label: '1/2', value: 1 / 2 },
        { label: '1/3', value: 1 / 3 },
        { label: '1/4', value: 1 / 4 },
        { label: '1/5', value: 1 / 5 },
      ];
      const defaultFraction = 1 / 3;
      const formatCost = costCopper => {
        if (costCopper <= 0) return 'Grátis';
        if (costCopper < 10) return `${costCopper} TC`;
        return precoDisplay(costCopper / 10);
      };
      const totalCost = (level, costs) => {
        if (level <= 0) return 0;
        return costs[level - 1] ?? 0;
      };

      const dialog = new Dialog({
        title: 'Aprimoramentos e Encantos',
        content: `
          <div class="t20-loja-upgrade-dialog">
            <div class="upgrade-row">
              <label>Item (opcional)</label>
              <input type="text" name="itemName" placeholder="Nome do item" />
            </div>
            <div class="upgrade-row">
              <label>Melhorias atuais</label>
              <input type="number" name="currentUpgrades" min="0" max="${UPGRADE_COSTS.length}" value="0" />
              <label>Adicionar</label>
              <input type="number" name="addUpgrades" min="0" max="${UPGRADE_COSTS.length}" value="0" />
            </div>
            <div class="upgrade-row">
              <label>Encantos atuais</label>
              <input type="number" name="currentEnchants" min="0" max="${ENCHANT_COSTS.length}" value="0" />
              <label>Adicionar</label>
              <input type="number" name="addEnchants" min="0" max="${ENCHANT_COSTS.length}" value="0" />
            </div>
            <div class="upgrade-row">
              <label>Material especial (TP)</label>
              <input type="number" name="extraCost" min="0" step="0.1" value="0" />
            </div>
            <div class="upgrade-row">
              <label>Forma</label>
              <select name="mode">
                <option value="buy" selected>Comprar</option>
                <option value="craft">Fabricar</option>
              </select>
            </div>
            <div class="upgrade-mode upgrade-mode-buy">
              <div class="upgrade-row">
                <label>Valor</label>
                <input type="range" class="upgrade-buy-range" min="1" max="200" step="1" value="100" />
                <input type="number" class="upgrade-buy-input" min="1" max="200" step="1" value="100" />
                <span>%</span>
              </div>
            </div>
            <div class="upgrade-mode upgrade-mode-craft" style="display:none;">
              <div class="upgrade-row">
                <label>Fração do preço</label>
                <select class="upgrade-craft-fraction">
                  ${fractions
                    .map(option => {
                      const selected = option.value === defaultFraction ? 'selected' : '';
                      return `<option value="${option.value}" ${selected}>${option.label}</option>`;
                    })
                    .join('')}
                </select>
              </div>
              <div class="upgrade-row">
                <label>Desconto matéria prima (TP)</label>
                <input type="number" class="upgrade-craft-discount" min="0" step="0.1" value="0" />
              </div>
            </div>
            <div class="upgrade-preview">
              <div><strong>Custo base:</strong> <span class="upgrade-base-cost">${formatCost(0)}</span></div>
              <div><strong>Total estimado:</strong> <span class="upgrade-total-cost">${formatCost(0)}</span></div>
            </div>
          </div>
        `,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-arrow-up"></i>',
            label: 'Aplicar',
            callback: html => {
              const itemName = (html.find('input[name="itemName"]').val() || '').trim();
              const currentUpgrades = Number(html.find('input[name="currentUpgrades"]').val()) || 0;
              const addUpgrades = Number(html.find('input[name="addUpgrades"]').val()) || 0;
              const currentEnchants = Number(html.find('input[name="currentEnchants"]').val()) || 0;
              const addEnchants = Number(html.find('input[name="addEnchants"]').val()) || 0;
              const extraCost = Math.max(0, Number(html.find('input[name="extraCost"]').val()) || 0);
              const mode = html.find('select[name="mode"]').val() || 'buy';
              const buyPercent = Math.min(200, Math.max(1, Number(html.find('.upgrade-buy-input').val()) || 100));
              const craftFraction = Number(html.find('.upgrade-craft-fraction').val()) || defaultFraction;
              const craftDiscount = Math.max(0, Number(html.find('.upgrade-craft-discount').val()) || 0);
              resolve({
                itemName,
                currentUpgrades,
                addUpgrades,
                currentEnchants,
                addEnchants,
                extraCost,
                mode,
                buyPercent,
                craftFraction,
                craftDiscount,
              });
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancelar',
            callback: () => resolve(null),
          },
        },
        default: 'confirm',
        close: () => resolve(null),
        render: html => {
          const currentUpgradesEl = html.find('input[name="currentUpgrades"]');
          const addUpgradesEl = html.find('input[name="addUpgrades"]');
          const currentEnchantsEl = html.find('input[name="currentEnchants"]');
          const addEnchantsEl = html.find('input[name="addEnchants"]');
          const extraCostEl = html.find('input[name="extraCost"]');
          const modeEl = html.find('select[name="mode"]');
          const buyRangeEl = html.find('.upgrade-buy-range');
          const buyInputEl = html.find('.upgrade-buy-input');
          const craftFractionEl = html.find('.upgrade-craft-fraction');
          const craftDiscountEl = html.find('.upgrade-craft-discount');
          const baseCostEl = html.find('.upgrade-base-cost');
          const totalCostEl = html.find('.upgrade-total-cost');

          const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

          const updatePreview = () => {
            const currentUpgrades = clamp(Number(currentUpgradesEl.val()) || 0, 0, UPGRADE_COSTS.length);
            const currentEnchants = clamp(Number(currentEnchantsEl.val()) || 0, 0, ENCHANT_COSTS.length);
            const addUpgrades = clamp(Number(addUpgradesEl.val()) || 0, 0, UPGRADE_COSTS.length - currentUpgrades);
            const addEnchants = clamp(Number(addEnchantsEl.val()) || 0, 0, ENCHANT_COSTS.length - currentEnchants);
            const extraCost = Math.max(0, Number(extraCostEl.val()) || 0);

            currentUpgradesEl.val(currentUpgrades);
            currentEnchantsEl.val(currentEnchants);
            addUpgradesEl.val(addUpgrades);
            addEnchantsEl.val(addEnchants);
            extraCostEl.val(extraCost);

            const targetUpgrades = currentUpgrades + addUpgrades;
            const targetEnchants = currentEnchants + addEnchants;
            const upgradesCost = totalCost(targetUpgrades, UPGRADE_COSTS) - totalCost(currentUpgrades, UPGRADE_COSTS);
            const enchantsCost = totalCost(targetEnchants, ENCHANT_COSTS) - totalCost(currentEnchants, ENCHANT_COSTS);
            const baseCostCopper = Math.max(0, Math.round((upgradesCost + enchantsCost + extraCost) * 10));

            const mode = modeEl.val();
            const buyPercent = clamp(Number(buyInputEl.val()) || 100, 1, 200);
            const craftFraction = Number(craftFractionEl.val()) || defaultFraction;
            const craftDiscount = Math.max(0, Number(craftDiscountEl.val()) || 0);

            buyInputEl.val(buyPercent);
            buyRangeEl.val(buyPercent);
            craftDiscountEl.val(craftDiscount);

            let totalCostCopper = baseCostCopper;
            if (mode === 'buy') {
              totalCostCopper = Math.round(baseCostCopper * (buyPercent / 100));
            } else {
              totalCostCopper = Math.max(0, Math.floor(baseCostCopper * craftFraction) - Math.round(craftDiscount * 10));
            }

            baseCostEl.text(formatCost(baseCostCopper));
            totalCostEl.text(formatCost(totalCostCopper));
          };

          const toggleMode = () => {
            const mode = modeEl.val();
            html.find('.upgrade-mode-buy').toggle(mode === 'buy');
            html.find('.upgrade-mode-craft').toggle(mode === 'craft');
            updatePreview();
          };

          currentUpgradesEl.on('input', updatePreview);
          addUpgradesEl.on('input', updatePreview);
          currentEnchantsEl.on('input', updatePreview);
          addEnchantsEl.on('input', updatePreview);
          extraCostEl.on('input', updatePreview);
          buyRangeEl.on('input', ev => {
            buyInputEl.val(ev.currentTarget.value);
            updatePreview();
          });
          buyInputEl.on('input', updatePreview);
          craftFractionEl.on('change', updatePreview);
          craftDiscountEl.on('input', updatePreview);
          modeEl.on('change', toggleMode);

          toggleMode();
        },
      });

      dialog.render(true);
    });
  }

  async _openUpgradeDialog() {
    const data = await this._promptUpgrade();
    if (!data) return;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const currentUpgrades = clamp(data.currentUpgrades, 0, UPGRADE_COSTS.length);
    const currentEnchants = clamp(data.currentEnchants, 0, ENCHANT_COSTS.length);
    const addUpgrades = clamp(data.addUpgrades, 0, UPGRADE_COSTS.length - currentUpgrades);
    const addEnchants = clamp(data.addEnchants, 0, ENCHANT_COSTS.length - currentEnchants);
    const extraCost = Math.max(0, data.extraCost || 0);

    if (addUpgrades + addEnchants === 0 && extraCost === 0) {
      return ui.notifications.warn('Selecione pelo menos uma melhoria, encanto ou custo adicional.');
    }

    const totalCost = (level, costs) => {
      if (level <= 0) return 0;
      return costs[level - 1] ?? 0;
    };

    const targetUpgrades = currentUpgrades + addUpgrades;
    const targetEnchants = currentEnchants + addEnchants;
    const upgradesCost = totalCost(targetUpgrades, UPGRADE_COSTS) - totalCost(currentUpgrades, UPGRADE_COSTS);
    const enchantsCost = totalCost(targetEnchants, ENCHANT_COSTS) - totalCost(currentEnchants, ENCHANT_COSTS);
    const baseCostCopper = Math.max(0, Math.round((upgradesCost + enchantsCost + extraCost) * 10));

    let totalCostCopper = baseCostCopper;
    let buyPercent = 100;
    let craftFraction = data.craftFraction ?? 1 / 3;
    let craftDiscount = data.craftDiscount ?? 0;

    if (data.mode === 'buy') {
      buyPercent = clamp(data.buyPercent ?? 100, 1, 200);
      totalCostCopper = Math.round(baseCostCopper * (buyPercent / 100));
    } else {
      craftFraction = data.craftFraction ?? 1 / 3;
      craftDiscount = Math.max(0, data.craftDiscount ?? 0);
      totalCostCopper = Math.max(0, Math.floor(baseCostCopper * craftFraction) - Math.round(craftDiscount * 10));
    }

    const wealth = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    if (totalCopper < totalCostCopper) {
      return ui.notifications.warn('Moedas insuficientes para aplicar aprimoramentos.');
    }

    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, totalCostCopper);

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    const formatCost = costCopper => {
      if (costCopper <= 0) return 'Grátis';
      if (costCopper < 10) return `${costCopper} TC`;
      return precoDisplay(costCopper / 10);
    };

    const itemName = data.itemName || 'Item';
    const messageContent = cartaoLoja({
      icone: 'fa-wand-sparkles',
      titulo: 'aplicou aprimoramentos',
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item">${itemName}</div>
        ${linhaCartao('Melhorias', `<b>+${addUpgrades}</b> <small>(já tinha ${currentUpgrades})</small>`)}
        ${linhaCartao('Encantos', `<b>+${addEnchants}</b> <small>(já tinha ${currentEnchants})</small>`)}
        ${linhaCartao('Custo base', `<b>${formatCost(baseCostCopper)}</b>`)}
        ${extraCost > 0 ? linhaCartao('Material especial', `<b>${formatCost(Math.round(extraCost * 10))}</b>`) : ''}
        ${data.mode === 'buy'
          ? linhaCartao('Compra', `<b>${buyPercent}%</b>`)
          : linhaCartao('Fabricação', `<b>${Math.round((craftFraction) * 100)}%</b> · ${craftDiscount > 0
              ? `desconto ${formatCost(Math.round(craftDiscount * 10))}`
              : '<small class="t20l-nulo">sem desconto</small>'}`)}
        ${linhaCartao('Total pago', `<b>${formatCost(totalCostCopper)}</b>`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
      mostrarTl: atorUsaPlatina(this.actor)
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.render();
  }

  _openCart() {
    if (!this._cartApp || this._cartApp._closed) {
      this._cartApp = new CartApplication(this);
    }
    this._cartApp.render(true);
  }

  /* ── Listeners ──────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    aplicarTemaLoja(this, this.actor);

    // Pesquisa
    const searchInputEl = html.find('.shop-search-input');
    searchInputEl.on('focus', () => {
      this._searchFocused = true;
    });
    searchInputEl.on('blur', () => {
      this._searchFocused = false;
    });
    searchInputEl.on('input', ev => {
      this._search = ev.currentTarget.value;
      this._searchFocused = true;
      this._scheduleSearchRender();
    });

    // Devolve o foco à barra de pesquisa após o render
    if (searchInputEl.length > 0 && this._searchFocused) {
      const searchInput = searchInputEl[0];
      searchInput.focus();
      // Coloca o cursor no final do texto
      const val = searchInput.value;
      searchInput.value = '';
      searchInput.value = val;
    }

    // Filtro de tipo
    html.find('.shop-type-filter').on('change', ev => {
      this._typeFilter = ev.currentTarget.value;
      this.render();
    });

    // Ordenação
    html.find('.shop-sort').on('change', ev => {
      this._sortBy = ev.currentTarget.value;
      this.render();
    });

    // Botão Comprar
    html.find('.btn-buy').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      this._purchaseItem(uuid);
    });

    // Botão Comprar (magia — abre escolha de poção/pergaminho)
    html.find('.btn-buy-spell').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      this._purchaseSpell(uuid);
    });

    // Botão Carrinho
    html.find('.btn-cart').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      this._addToCart(uuid);
    });

    // Botão Construir
    html.find('.btn-craft').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      this._craftItem(uuid);
    });

    // Botão Construir (magia — abre escolha de poção/pergaminho, depois fabricação)
    html.find('.btn-craft-spell').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      this._craftSpell(uuid);
    });

    // Botão Vender
    html.find('.btn-sell').on('click', ev => {
      const itemId = ev.currentTarget.dataset.itemId;
      this._sellItem(itemId);
    });

    // Alternar modo
    html.find('.shop-mode-toggle button').on('click', ev => {
      const mode = ev.currentTarget.dataset.mode;
      if (!mode || mode === this._mode) return;
      this._mode = mode;
      this.render();
    });

    // Percentual de venda
    const sellRange = html.find('.shop-sell-percent');
    const sellInput = html.find('.shop-sell-percent-input');
    const applySellPercent = value => {
      const clamped = Math.min(100, Math.max(1, Number(value) || 1));
      this._sellPercent = clamped;
      sellRange.val(clamped);
      sellInput.val(clamped);
    };

    sellRange.on('input', ev => {
      applySellPercent(ev.currentTarget.value);
    });

    sellRange.on('change', () => {
      this.render();
    });

    // Botões −10% / +10% do percentual de venda
    html.find('.sell-pct-step').on('click', ev => {
      applySellPercent(this._sellPercent + Number(ev.currentTarget.dataset.step));
      this.render();
    });

    // Percentual de preço do modo compra (0%–200%, padrão 100%). O piso é
    // 0 (não negativo) — com piso 10 antigo, digitar "20" ficava preso em
    // "10" assim que o primeiro caractere ("2") era corrigido para cima a
    // cada tecla. `value === ''`/NaN cai no padrão 100; um "0" explícito
    // (dígito válido, só falsy em JS) precisa ser tratado à parte, senão
    // `Number(value) || 100` também travaria "0" de volta em "100".
    const buyRange = html.find('.shop-buy-percent');
    const buyInput = html.find('.shop-buy-percent-input');
    const applyBuyPercent = value => {
      const num = Number(value);
      const base = (value === '' || !Number.isFinite(num)) ? 100 : num;
      const clamped = Math.min(200, Math.max(0, base));
      this._buyPercent = clamped;
      buyRange.val(clamped);
      buyInput.val(clamped);
    };
    buyRange.on('input', ev => applyBuyPercent(ev.currentTarget.value));
    buyRange.on('change', () => this.render());
    buyInput.on('input', ev => applyBuyPercent(ev.currentTarget.value));
    buyInput.on('change', () => this.render());
    html.find('.buy-pct-step').on('click', ev => {
      applyBuyPercent(this._buyPercent + Number(ev.currentTarget.dataset.step));
      this.render();
    });

    sellInput.on('input', ev => {
      applySellPercent(ev.currentTarget.value);
    });

    sellInput.on('change', () => {
      this.render();
    });

    // Filtros avançados
    const sideFilters = html.find('.shop-side-filters');
    if (sideFilters.length) {
      requestAnimationFrame(() => {
        sideFilters.scrollTop(this._sideFilterScroll || 0);
      });
      sideFilters.on('scroll', () => {
        this._sideFilterScroll = sideFilters.scrollTop();
      });
    }
    html.find('.side-filter-group').each((_, el) => {
      const key = el.dataset.group;
      if (!key) return;
      if (el.open) {
        this._openFilterGroups.add(key);
      }
    });

    html.find('.shop-filter-checkbox').each((_, el) => {
      el.checked = this._filterTags.has(el.dataset.tag);
    });

    html.find('.side-filter-group').each((_, el) => {
      const key = el.dataset.group;
      if (!key) return;
      el.open = this._openFilterGroups.has(key);
      // A seta (::before) segue esta classe, não o atributo [open] — assim
      // ela pode "virar" antes do atributo mudar de fato (ver animação
      // de expandir/recolher logo abaixo).
      el.classList.toggle('t20l-open', el.open);
    });

    // Expandir/recolher animado dos grupos de filtro: <details> não anima
    // altura nativamente, então a transição é feita "na mão" com a Web
    // Animations API, animando o painel de 0 até sua altura natural (e
    // vice-versa) em vez do salto instantâneo padrão do navegador.
    html.find('.side-filter-group').each((_, groupEl) => {
      const summaryEl = groupEl.querySelector(':scope > summary');
      const panelEl = groupEl.querySelector(':scope > .filter-options');
      if (!summaryEl || !panelEl) return;

      // O checkbox "marcar categoria inteira" mora DENTRO do <summary>. O
      // <details> nativo alterna aberto/fechado em QUALQUER clique dentro
      // do <summary> — mesmo em elementos interativos aninhados — e isso
      // NÃO depende de nenhum handler nosso, então preventDefault() no
      // listener do summary (abaixo) não adianta: ele cancelaria também o
      // toggle nativo do PRÓPRIO checkbox (mesmo evento, mesmo
      // defaultPrevented, revertido ao valor anterior depois do clique).
      // stopPropagation() no wrapper do checkbox resolve os dois lados:
      // impede o clique de alcançar o <summary> (então não abre/fecha o
      // grupo) sem tocar no defaultPrevented (então o checkbox alterna
      // normalmente e dispara "change" como qualquer checkbox).
      const inlineCheckboxLabel = summaryEl.querySelector('.filter-option-inline');
      if (inlineCheckboxLabel) {
        inlineCheckboxLabel.addEventListener('click', ev => ev.stopPropagation());
      }

      summaryEl.addEventListener('click', ev => {
        ev.preventDefault();
        groupEl._t20Anim?.cancel();

        if (!groupEl.open) {
          groupEl.classList.add('t20l-open');
          groupEl.open = true;
          const target = panelEl.scrollHeight;
          panelEl.style.overflow = 'hidden';
          panelEl.style.height = '0px';
          groupEl._t20Anim = panelEl.animate(
            [{ height: '0px' }, { height: `${target}px` }],
            { duration: 180, easing: 'ease-out' }
          );
          groupEl._t20Anim.onfinish = () => {
            panelEl.style.removeProperty('height');
            panelEl.style.removeProperty('overflow');
            groupEl._t20Anim = null;
          };
        } else {
          groupEl.classList.remove('t20l-open');
          const start = panelEl.scrollHeight;
          panelEl.style.overflow = 'hidden';
          panelEl.style.height = `${start}px`;
          groupEl._t20Anim = panelEl.animate(
            [{ height: `${start}px` }, { height: '0px' }],
            { duration: 150, easing: 'ease-in' }
          );
          groupEl._t20Anim.onfinish = () => {
            groupEl.open = false;
            panelEl.style.removeProperty('height');
            panelEl.style.removeProperty('overflow');
            groupEl._t20Anim = null;
          };
        }
      });
    });

    html.find(`input[name="shop-filter-match"][value="${this._filterMatch}"]`).prop('checked', true);

    html.find('.shop-filter-checkbox').on('change', ev => {
      const tag = ev.currentTarget.dataset.tag;
      if (!tag) return;
      if (ev.currentTarget.checked) {
        this._filterTags.add(tag);
      } else {
        this._filterTags.delete(tag);
      }
      if (sideFilters.length) {
        this._sideFilterScroll = sideFilters.scrollTop();
      }
      this.render();
    });

    html.find('.btn-filter-reset').on('click', () => {
      this._filterTags.clear();
      this._filterMatch = 'any';
      this._search = '';
      this._typeFilter = 'all';
      this.render();
    });

    html.find('.btn-open-cart').on('click', () => {
      this._openCart();
    });

    html.find('.btn-open-upgrade').on('click', () => {
      this._openUpgradeDialog();
    });

    html.find('.side-filter-group').on('toggle', ev => {
      const key = ev.currentTarget.dataset.group;
      if (!key) return;
      if (ev.currentTarget.open) {
        this._openFilterGroups.add(key);
      } else {
        this._openFilterGroups.delete(key);
      }
    });

    html.find('input[name="shop-filter-match"]').on('change', ev => {
      this._filterMatch = ev.currentTarget.value;
      if (sideFilters.length) {
        this._sideFilterScroll = sideFilters.scrollTop();
      }
      this.render();
    });

    // Filtro de itens acessíveis
    html.find('.shop-affordable-only').on('change', ev => {
      this._affordableOnly = ev.currentTarget.checked;
      this.render();
    });

    // Não exibir magias
    html.find('.shop-hide-spells').on('change', ev => {
      this._hideSpells = ev.currentTarget.checked;
      this.render();
    });

    // Expandir/colapsar descrição do item
    html.find('.shop-item-name').on('click', async ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      if (!uuid) return;
      const item = await fromUuid(uuid);
      if (item) {
        item.sheet.render(true);
      }
    });

    // Drag de item (para arrastar para fichas, cenas, etc.)
    html.find('.shop-item-img').on('dragstart', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      ev.originalEvent.dataTransfer.setData('text/plain', JSON.stringify({ type: 'Item', uuid }));
    });
  }
}

class CartApplication extends Application {
  constructor(shopApp, options = {}) {
    super(options);
    this.shopApp = shopApp;
    this._discountPercent = 100;
    this._closed = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `t20-loja-cart-${foundry.utils.randomID(4)}`,
      title: 'Carrinho de compras',
      template: `modules/t20-hayd-loja/templates/cart.hbs`,
      width: 520,
      height: 520,
      resizable: true,
      classes: ['t20-loja-window', 't20-loja-cart-window'],
      scrollY: ['.cart-items-list'],
    });
  }

  async getData() {
    const items = Array.from(this.shopApp._cartItems.values());
    const totals = calculateCartTotals(items, this._discountPercent);
    return {
      actor: this.shopApp.actor,
      items: totals.lines,
      totalDisplay: totals.totalDisplay,
      discountPercent: this._discountPercent,
      hasItems: items.length > 0,
    };
  }

  close(options = {}) {
    this._closed = true;
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    aplicarTemaLoja(this, this.shopApp.actor);

    html.find('.btn-remove-cart-item').on('click', ev => {
      const key = ev.currentTarget.dataset.key;
      if (!key) return;
      this.shopApp._cartItems.delete(key);
      this.render();
    });

    html.find('.cart-qty-input').on('input', ev => {
      const key = ev.currentTarget.dataset.key;
      const item = this.shopApp._cartItems.get(key);
      if (!item) return;
      const value = Math.max(1, Number(ev.currentTarget.value) || 1);
      item.qty = value;
      ev.currentTarget.value = value;
    });

    html.find('.cart-qty-input').on('change', () => {
      this.render();
    });

    html.find('.btn-clear-cart').on('click', () => {
      this.shopApp._cartItems.clear();
      this.render();
    });

    const discountRange = html.find('.cart-discount-range');
    const discountInput = html.find('.cart-discount-input');
    const applyDiscount = value => {
      const clamped = Math.min(200, Math.max(1, Number(value) || 1));
      this._discountPercent = clamped;
      discountRange.val(clamped);
      discountInput.val(clamped);
    };

    discountRange.on('input', ev => {
      applyDiscount(ev.currentTarget.value);
    });

    discountRange.on('change', () => {
      this.render();
    });

    // Botões −10% / +10% do percentual do carrinho
    html.find('.cart-pct-step').on('click', ev => {
      applyDiscount(this._discountPercent + Number(ev.currentTarget.dataset.step));
      this.render();
    });

    discountInput.on('input', ev => {
      applyDiscount(ev.currentTarget.value);
    });

    discountInput.on('change', () => {
      this.render();
    });

    html.find('.btn-checkout-cart').on('click', () => {
      this._checkout();
    });
  }

  async _checkout() {
    const items = Array.from(this.shopApp._cartItems.values());
    if (!items.length) return;

    const { total } = calculateCartTotals(items, this._discountPercent);
    const wealth = this.shopApp._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    const costCopper = Math.round(total * 10);

    if (totalCopper < costCopper) {
      return ui.notifications.warn('Moedas insuficientes para finalizar a compra.');
    }

    const { to: newTo, tp: newTp, tc: newTc, troco, pago } = debitarCarteira(wealth, costCopper);

    const purchasedLines = [];

    for (const item of items) {
      // O item da magia já foi montado (aprimoramentos gravados nas
      // rolagens) no momento em que foi adicionado ao carrinho — só falta
      // ajustar a quantidade final escolhida aqui.
      if (item.isSpell) {
        const itemData = foundry.utils.deepClone(item.spellItemData);
        itemData.system.qtd = item.qty;
        const existing = this.shopApp.actor.items.find(i => i.getFlag(MODULE_ID, 'spellDedupeKey') === item.spellDedupeKey);
        if (existing && existing.system?.qtd !== undefined) {
          await existing.update({ 'system.qtd': (existing.system.qtd || 1) + item.qty });
        } else {
          const [created] = await this.shopApp.actor.createEmbeddedDocuments('Item', [itemData]);
          if (created) {
            await created.setFlag(MODULE_ID, 'sourceUuid', item.uuid);
            await created.setFlag(MODULE_ID, 'spellDedupeKey', item.spellDedupeKey);
          }
        }
        purchasedLines.push({
          name: itemData.name,
          qty: item.qty,
          paid: precoDisplay(item.preco * item.qty * (this._discountPercent / 100)),
        });
        continue;
      }

      let sourceDoc;
      try {
        sourceDoc = await fromUuid(item.uuid);
      } catch (e) {
        console.warn(`${MODULE_ID} | Não foi possível carregar item ${item.uuid}`, e);
        continue;
      }
      if (!sourceDoc) continue;

      const existing = this.shopApp.actor.items.find(i => {
        const flag = i.getFlag(MODULE_ID, 'sourceUuid');
        return flag === item.uuid || i.name === sourceDoc.name;
      });

      if (existing && existing.system?.qtd !== undefined) {
        await existing.update({ 'system.qtd': (existing.system.qtd || 1) + item.qty });
      } else {
        const itemData = sourceDoc.toObject();
        itemData.system.qtd = item.qty;
        const [created] = await this.shopApp.actor.createEmbeddedDocuments('Item', [itemData]);
        if (created) await created.setFlag(MODULE_ID, 'sourceUuid', item.uuid);
      }

      purchasedLines.push({
        name: item.name,
        qty: item.qty,
        paid: precoDisplay(item.preco * item.qty * (this._discountPercent / 100)),
      });
    }

    await this.shopApp.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    }, { t20lojaInterno: true });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      const linhas = purchasedLines
        .map(line => `<div class="t20l-item t20l-compacto">${line.name}${line.qty > 1 ? ` <em>×${line.qty}</em>` : ''}<b>${line.paid}</b></div>`)
        .join('');
      const messageContent = cartaoLoja({
        icone: 'fa-shopping-cart',
        titulo: this._discountPercent === 100
          ? 'finalizou a compra'
          : `finalizou a compra (${this._discountPercent}% do preço)`,
        ator: this.shopApp.actor.name,
        corpo: `
          ${linhas}
          ${linhaCartao('Total', `<b>${precoDisplay(total)}</b>`)}
          ${linhaPagamento(pago)}
          ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
        saldo: { tl: wealth.tl, to: newTo, tp: newTp, tc: newTc },
        mostrarTl: atorUsaPlatina(this.shopApp.actor)
      });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.shopApp.actor }),
        content: messageContent,
        whisper: getChatRecipients(),
      });
    }

    this.shopApp._cartItems.clear();
    this.shopApp.render();
    this.render();
  }
}
