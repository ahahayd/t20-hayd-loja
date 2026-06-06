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

import { MODULE_ID } from './main.js';

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

const UPGRADE_COSTS = [300, 3000, 9000, 18000];
const ENCHANT_COSTS = [18000, 36000, 72000];

function typeLabel(type) {
  return TYPE_LABELS[type] ?? type ?? 'Item';
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
  const preco = Number(doc.system?.preco) || 0;
  const espacosBase = Number(doc.system?.espacos) || 0;
  const qtd = Number(doc.system?.qtd) || 1;
  const espacos = espacosBase * qtd;
  const filterTags = buildFilterTags(doc);
  return {
    uuid        : doc.uuid,
    name        : doc.name,
    img         : doc.img ?? 'icons/svg/item-bag.svg',
    type        : doc.type,
    typeLabel   : typeLabel(doc.type),
    preco,
    precoDisplay: precoDisplay(preco),
    espacos,
    filterTags,
    source      : doc.system?.source ?? '',
  };
}

/** Carrega e formata todos os itens das fontes configuradas. */
async function buildShopItems() {
  const items = [];
  const seen  = new Set();   // evita duplicatas por UUID

  const addItem = (doc) => {
    if (!doc) return;
    const preco = doc.system?.preco;
    if (preco === undefined || preco === null || preco === '' || Number(preco) <= 0) return;
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
    this._affordableOnly = true;
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
      template: `modules/loja-t20/templates/shop.hbs`,
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

    const filtered  = this._applyFilters(this._allItems);
  const sorted    = this._applySort(filtered);
    const sellItemsRaw = this._getSellItems();
    const sellFiltered = this._applyFilters(sellItemsRaw);
    const sellSorted = this._applySort(sellFiltered);
    const wealth    = this._wealthInfo();
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);

    // Enriquece itens com flag "pode comprar"
    let buyItems = sorted.map(item => ({
      ...item,
      canAfford : totalCopper >= Math.round(item.preco * 10),
    }));

    if (this._affordableOnly) {
      buyItems = buyItems.filter(item => item.canAfford);
    }

    const sellItems = sellSorted.map(item => ({
      ...item,
      sellPriceDisplay: precoDisplay(item.sellPrice),
    }));

    // Coleta tipos únicos para o filtro
    const types = [...new Set(this._allItems.map(i => i.type))]
      .sort()
      .map(t => ({ value: t, label: typeLabel(t) }));

    const isSellMode = this._mode === 'sell';
    return {
      actor      : this.actor,
      items      : isSellMode ? sellItems : buyItems,
      types,
      search     : this._search,
      typeFilter : this._typeFilter,
      sortBy     : this._sortBy,
      wealth,
      loading    : this._loading,
      totalItems : isSellMode ? sellFiltered.length : filtered.length,
      mode       : this._mode,
      sellPercent: this._sellPercent,
      affordableOnly: this._affordableOnly,
      filterMatch: this._filterMatch,
    };
  }

  /* ── Carregamento de itens ──────────────────── */
  async _loadAllItems() {
    this._loading = true;
    this._loaded  = false;

    // Só mostra o spinner se o cache ainda não estiver pronto; com o cache
    // aquecido (pré-carregado no boot) a abertura é instantânea.
    if (!shopItemsCacheReady()) this.render();

    try {
      this._allItems = await getShopItems();
    } catch (e) {
      console.error(`${MODULE_ID} | Falha ao carregar itens da loja`, e);
      this._allItems = [];
    }

    this._loaded   = true;
    this._loading  = false;
    this.render();
  }

  _getSellItems() {
    const percent = this._sellPercent / 100;
    return this.actor.items.map(item => {
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
        normalizeText(i.name).includes(q) ||
        normalizeText(i.typeLabel).includes(q)
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
      case 'type'       : return copy.sort((a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.name.localeCompare(b.name));
      default           : return copy.sort((a, b) => a.name.localeCompare(b.name));
    }
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
    const costCopper  = Math.round(shopItem.preco * qty * 10);

    if (totalCopper < costCopper) {
      return ui.notifications.warn(
        `${this.actor.name} não tem moedas suficientes para comprar "${shopItem.name}"!`
      );
    }

    // Calcula novo saldo
    const remaining = totalCopper - costCopper;
    let newTo, newTp, newTc;

    // Redistribui tudo normalmente
    ({ to: newTo, tp: newTp, tc: newTc } = fromCobre(remaining));

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
    });

    const messageContent = `
      <div class="t20-loja-message">
        <p><strong>${this.actor.name}</strong> comprou:</p>
        <ul>
          <li><strong>Item:</strong> ${shopItem.name}</li>
          <li><strong>Quantidade:</strong> ${qty}</li>
          <li><strong>Preço:</strong> ${shopItem.precoDisplay}</li>
          <li><strong>Saldo final:</strong> ${newTo} TO | ${newTp} TP | ${newTc} TC</li>
        </ul>
      </div>
    `;

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
    const totalCopper = toCobre(wealth.to, wealth.tp, wealth.tc);
    const newTotal = totalCopper + sellCopper;
    const { to: newTo, tp: newTp, tc: newTc } = fromCobre(newTotal);

    if (sellQty >= qtd) {
      await item.delete();
    } else {
      await item.update({ 'system.qtd': qtd - sellQty });
    }

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    });

    const messageContent = `
      <div class="t20-loja-message">
        <p><strong>${this.actor.name}</strong> vendeu:</p>
        <ul>
          <li><strong>Item:</strong> ${item.name}</li>
          <li><strong>Quantidade:</strong> ${sellQty}</li>
          <li><strong>Percentual:</strong> ${Math.round(percent * 100)}%</li>
          <li><strong>Recebido:</strong> ${precoDisplay(preco * sellQty * percent)}</li>
          <li><strong>Saldo final:</strong> ${newTo} TO | ${newTp} TP | ${newTc} TC</li>
        </ul>
      </div>
    `;

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
        uuid,
        name: shopItem.name,
        img: shopItem.img,
        preco: shopItem.preco,
        qty,
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

    const remaining = totalCopper - costCopper;
    const { to: newTo, tp: newTp, tc: newTc } = fromCobre(remaining);

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
    });

    const messageContent = `
      <div class="t20-loja-message">
        <p><strong>${this.actor.name}</strong> construiu:</p>
        <ul>
          <li><strong>Item:</strong> ${shopItem.name}</li>
          <li><strong>Quantidade:</strong> ${qty}</li>
          <li><strong>Fração do preço:</strong> ${fractionLabel}</li>
          <li><strong>Custo por item:</strong> ${formatCraftCost(unitCostCopper)}</li>
          <li><strong>Desconto matéria prima:</strong> ${formatCraftCost(Math.round(materialDiscount * 10))}</li>
          <li><strong>Total pago:</strong> ${formatCraftCost(totalCostCopper)}</li>
          <li><strong>Saldo final:</strong> ${newTo} TO | ${newTp} TP | ${newTc} TC</li>
        </ul>
      </div>
    `;

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

    const remaining = totalCopper - totalCostCopper;
    const { to: newTo, tp: newTp, tc: newTc } = fromCobre(remaining);

    await this.actor.update({
      'system.dinheiro.to': newTo,
      'system.dinheiro.tp': newTp,
      'system.dinheiro.tc': newTc,
    });

    const formatCost = costCopper => {
      if (costCopper <= 0) return 'Grátis';
      if (costCopper < 10) return `${costCopper} TC`;
      return precoDisplay(costCopper / 10);
    };

    const itemName = data.itemName || 'Item';
    const messageContent = `
      <div class="t20-loja-message">
        <p><strong>${this.actor.name}</strong> aplicou aprimoramentos:</p>
        <ul>
          <li><strong>Item:</strong> ${itemName}</li>
          <li><strong>Melhorias:</strong> +${addUpgrades} (já tinha ${currentUpgrades})</li>
          <li><strong>Encantos:</strong> +${addEnchants} (já tinha ${currentEnchants})</li>
          <li><strong>Custo base:</strong> ${formatCost(baseCostCopper)}</li>
          ${extraCost > 0 ? `<li><strong>Material especial:</strong> ${formatCost(Math.round(extraCost * 10))}</li>` : ''}
          ${data.mode === 'buy'
            ? `<li><strong>Compra:</strong> ${buyPercent}%</li>`
            : `<li><strong>Fabricação:</strong> ${Math.round((craftFraction) * 100)}% | ${craftDiscount > 0
                ? `Desconto ${formatCost(Math.round(craftDiscount * 10))}`
                : 'Sem desconto'}</li>`}
          <li><strong>Total pago:</strong> ${formatCost(totalCostCopper)}</li>
          <li><strong>Saldo final:</strong> ${newTo} TO | ${newTp} TP | ${newTc} TC</li>
        </ul>
      </div>
    `;

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
      template: `modules/loja-t20/templates/cart.hbs`,
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

    html.find('.btn-remove-cart-item').on('click', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      if (!uuid) return;
      this.shopApp._cartItems.delete(uuid);
      this.render();
    });

    html.find('.cart-qty-input').on('input', ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      const item = this.shopApp._cartItems.get(uuid);
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

    const remaining = totalCopper - costCopper;
    const { to: newTo, tp: newTp, tc: newTc } = fromCobre(remaining);

    const purchasedLines = [];

    for (const item of items) {
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
    });

    if (game.settings.get(MODULE_ID, 'enableChatMessages')) {
      const messageContent = `
        <div class="t20-loja-message">
          <p><strong>${this.shopApp.actor.name}</strong> comprou:</p>
          <ul>
            ${purchasedLines.map(line => `<li><strong>${line.name}</strong> x${line.qty} — ${line.paid}</li>`).join('')}
            <li><strong>Desconto/Acréscimo:</strong> ${this._discountPercent}%</li>
            <li><strong>Total:</strong> ${precoDisplay(total)}</li>
            <li><strong>Saldo final:</strong> ${newTo} TO | ${newTp} TP | ${newTc} TC</li>
          </ul>
        </div>
      `;

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
