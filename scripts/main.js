/**
 * t20-loja — Módulo de Loja para Tormenta20 no FoundryVTT
 * Ponto de entrada principal.
 */

import { ShopApplication, warmShopItemsCache, invalidateShopItemsCache } from './shop-app.js';
import { ShopSettingsApplication } from './settings-app.js';

export const MODULE_ID = 't20-hayd-loja';

/* ─────────────────────────────────────────────
   Integração com o tema t20-hayd-ui
───────────────────────────────────────────── */

/** true quando o módulo de tema t20-hayd-ui está ativo no mundo. */
export function temaHayd() {
  return game.modules?.get('t20-hayd-ui')?.active === true;
}

/** Cor padrão do t20-hayd-ui (alterável nas configurações do mundo). */
function corPadraoTema() {
  try {
    const v = game.settings.get('t20-hayd-ui', 'corPadrao');
    if (typeof v === 'string' && v) return v;
  } catch (_e) { /* módulo/configuração ausente */ }
  return '#960505';
}

function corCSSDoUsuario(user) {
  const c = user?.color;
  if (c == null) return null;
  if (typeof c === 'string') return c;
  if (typeof c.css === 'string') return c.css;
  const s = c.toString?.();
  return (typeof s === 'string' && s.startsWith('#')) ? s : null;
}

/**
 * Cor de destaque de um ator seguindo as regras do t20-hayd-ui:
 * cor do primeiro dono jogador (ordem alfabética); sem dono jogador
 * (ou modo "padrão" configurado no t20-hayd-ui) → cor padrão do tema.
 */
export function corDestaqueAtor(ator) {
  if (!ator) return corPadraoTema();
  const bruto = ator.getFlag?.('t20-hayd-ui', 'configCor');
  const modo = (bruto && typeof bruto === 'object')
    ? (bruto.mode === 'custom' ? 'padrao' : 'auto')
    : (bruto ?? 'auto');
  if (modo !== 'padrao') {
    const donos = game.users
      .filter(u => !u.isGM && ator.testUserPermission?.(u, 'OWNER'))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'));
    for (const dono of donos) {
      const c = corCSSDoUsuario(dono);
      if (c) return c;
    }
  }
  return corPadraoTema();
}

/**
 * Aplica (ou remove) o tema Hayd na janela de uma Application V1.
 * A cor de destaque segue o ator que está usando a loja (cor do jogador
 * dono, como no t20-hayd-ui). Sem o t20-hayd-ui, o visual fica o padrão
 * neutro do Foundry.
 */
export function aplicarTemaLoja(app, ator = null) {
  const el = app.element?.[0];
  if (!el) return;
  const tema = temaHayd();
  el.classList.toggle('tema-hayd', tema);
  if (tema) el.style.setProperty('--loja-destaque', corDestaqueAtor(ator));
  else el.style.removeProperty('--loja-destaque');
}

/* ─────────────────────────────────────────────
   INIT — Registro de configurações
───────────────────────────────────────────── */
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Inicializando módulo Tormenta20 Loja`);

  // Lista de IDs de compêndios extras (ex: "world.meu-compendio")
  game.settings.register(MODULE_ID, 'extraCompendiums', {
    name: 'Compêndios Adicionais',
    hint: 'Compêndios de itens adicionais que aparecerão na loja.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Lista de UUIDs de itens individuais extras
  game.settings.register(MODULE_ID, 'extraItems', {
    name: 'Itens Individuais',
    hint: 'UUIDs de itens individuais que aparecerão na loja.',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Se deve incluir compêndios do sistema automaticamente
  game.settings.register(MODULE_ID, 'includeSystemPacks', {
    name: 'Incluir Compêndios do Sistema',
    hint: 'Inclui automaticamente todos os compêndios de itens do sistema Tormenta20.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => warmShopItemsCache()
  });

  // Se deve incluir itens do mundo (World Items)
  game.settings.register(MODULE_ID, 'includeWorldItems', {
    name: 'Incluir Itens do Mundo',
    hint: 'Inclui os itens cadastrados diretamente no mundo (aba Itens do sidebar).',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => warmShopItemsCache()
  });

  // Mensagens de compra/venda no chat
  game.settings.register(MODULE_ID, 'enableChatMessages', {
    name: 'Enviar mensagem no chat ao comprar/vender',
    hint: 'Quando habilitado, envia mensagem no chat para compras e vendas.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Mensagem apenas para o mestre (whisper)
  game.settings.register(MODULE_ID, 'whisperChatMessages', {
    name: 'Enviar mensagem no chat apenas para o mestre',
    hint: 'Quando habilitado, envia as mensagens de compra/venda apenas como whisper para mestres.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'monitorPlayerMoneyChanges', {
    name: 'Monitorar mudanças de moedas feitas por jogadores',
    hint: 'Quando habilitado, registra no chat mudanças manuais de moedas feitas por jogadores (mestres e macros não disparam).',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'monitorAllMoneyChanges', {
    name: 'Monitorar mudanças de moedas em todos os casos',
    hint: 'Quando habilitado, registra no chat mudanças de moedas mesmo quando mestres ou macros alteram o dinheiro.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  // Menu de configurações avançadas (compêndios e itens individuais)
  game.settings.registerMenu(MODULE_ID, 'shopSettingsMenu', {
    name: 'Configurar Fontes da Loja',
    label: 'Abrir Configurações',
    hint: 'Configure quais compêndios e itens individuais aparecem na loja.',
    icon: 'fas fa-boxes',
    type: ShopSettingsApplication,
    restricted: true
  });
});

/* ─────────────────────────────────────────────
   READY — Pré-carrega os itens da loja
───────────────────────────────────────────── */
Hooks.once('ready', () => {
  // Não bloqueia o carregamento do mundo: aquece o cache em segundo plano
  // para que a primeira abertura da loja seja instantânea.
  warmShopItemsCache();
});

// Invalida (e reaquece) o cache quando itens do mundo são alterados.
// Itens embutidos (em fichas) e de compêndio não afetam a lista da loja.
const onWorldItemChange = item => {
  if (item?.isEmbedded || item?.pack) return;
  invalidateShopItemsCache();
  warmShopItemsCache();
};
Hooks.on('createItem', onWorldItemChange);
Hooks.on('updateItem', onWorldItemChange);
Hooks.on('deleteItem', onWorldItemChange);

/* ─────────────────────────────────────────────
   Injeta botão nas fichas de personagem
───────────────────────────────────────────── */
Hooks.on('renderActorSheet', (app, html, _data) => {
  const actor = app.actor;

  // Só adiciona para atores com sistema de dinheiro (personagens jogáveis)
  if (!actor?.system?.dinheiro) return;

  // Evita duplicar o botão em re-renders
  const existingBtn = html.closest('.app').find('.t20-loja-btn');
  if (existingBtn.length > 0) return;

  const btn = $(`
    <a class="t20-loja-btn header-button control" title="Abrir Loja">
      <i class="fas fa-store"></i>
      <span>Loja</span>
    </a>
  `);

  btn.on('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    // Reutiliza janela existente se já aberta para este ator
    const existing = Object.values(ui.windows).find(
      w => w instanceof ShopApplication && w.actor.id === actor.id
    );
    if (existing) {
      existing.bringToTop();
    } else {
      new ShopApplication(actor).render(true);
    }
  });

  // Insere antes do botão de fechar
  html.closest('.app').find('.window-header .close').before(btn);
});

const moneySnapshots = new Map();

function formatCoins(data) {
  return `${data.to || 0} TO | ${data.tp || 0} TP | ${data.tc || 0} TC`;
}

function formatDelta(delta) {
  const sign = value => (value >= 0 ? `+${value}` : `${value}`);
  return `${sign(delta.to)} TO | ${sign(delta.tp)} TP | ${sign(delta.tc)} TC`;
}

Hooks.on('preUpdateActor', (actor, data) => {
  if (!data?.system?.dinheiro) return;
  moneySnapshots.set(actor.id, foundry.utils.deepClone(actor.system?.dinheiro ?? {}));
});

Hooks.on('updateActor', (actor, data, _options, userId) => {
  if (!data?.system?.dinheiro) return;

  const monitorAll = game.settings.get(MODULE_ID, 'monitorAllMoneyChanges');
  const monitorPlayers = game.settings.get(MODULE_ID, 'monitorPlayerMoneyChanges');
  if (!monitorAll && !monitorPlayers) return;

  const user = game.users.get(userId);
  if (!monitorAll && user?.isGM) return;

  const previous = moneySnapshots.get(actor.id);
  moneySnapshots.delete(actor.id);
  if (!previous) return;

  const current = actor.system?.dinheiro ?? {};
  const delta = {
    to: (current.to || 0) - (previous.to || 0),
    tp: (current.tp || 0) - (previous.tp || 0),
    tc: (current.tc || 0) - (previous.tc || 0),
  };

  if (delta.to === 0 && delta.tp === 0 && delta.tc === 0) return;

  const messageContent = `
    <div class="t20-loja-message">
      <p><strong>${actor.name}</strong> alterou moedas:</p>
      <ul>
        <li><strong>Antes:</strong> ${formatCoins(previous)}</li>
        <li><strong>Alteração:</strong> ${formatDelta(delta)}</li>
        <li><strong>Novo saldo:</strong> ${formatCoins(current)}</li>
      </ul>
    </div>
  `;

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: messageContent,
    whisper: game.users.filter(user => user.isGM).map(user => user.id),
  });
});
