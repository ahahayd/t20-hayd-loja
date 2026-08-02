/**
 * t20-loja — Módulo de Loja para Tormenta20 no FoundryVTT
 * Ponto de entrada principal.
 */

import { ShopApplication, warmShopItemsCache, invalidateShopItemsCache, moedasChips, cartaoLoja, linhaCartao, atorUsaPlatina } from './shop-app.js';
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
  // Modo "custom" do t20-hayd-ui: cor escolhida pelo dono da ficha
  if (bruto && typeof bruto === 'object' && bruto.mode === 'custom'
    && /^#[0-9a-f]{6}$/i.test(bruto.cor ?? '')) {
    return bruto.cor;
  }
  const modo = (bruto && typeof bruto === 'object') ? 'auto' : (bruto ?? 'auto');
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

  // Troco realista: paga em espécie, sem normalizar a carteira
  game.settings.register(MODULE_ID, 'trocoRealista', {
    name: 'Troco realista (moedas em espécie)',
    hint: 'O mercador passa a dar troco como na vida real: o personagem paga com as moedas que tem no bolso e recebe a diferença em cobre e prata — ou em ouro, nas compras mais caras. As moedas param de ser reorganizadas automaticamente a cada compra.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  // Limiar (em TP) a partir do qual o troco vem em Tibares de Ouro
  game.settings.register(MODULE_ID, 'limiarTrocoTO', {
    name: 'Troco realista: limiar para troco em TO',
    hint: 'Compras a partir deste valor (em T$/TP) recebem o troco em Tibares de Ouro. Padrão: 1000.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1000
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
// Debounced: uma importação em massa de N itens dispara UMA reconstrução
// (antes eram N), e mundos sem "incluir itens do mundo" nem reconstroem.
const rebuildShopCache = foundry.utils.debounce(() => {
  invalidateShopItemsCache();
  warmShopItemsCache();
}, 250);
const onWorldItemChange = item => {
  if (item?.isEmbedded || item?.pack) return;
  if (!game.settings.get(MODULE_ID, 'includeWorldItems')) return;
  rebuildShopCache();
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

Hooks.on('preUpdateActor', (actor, data) => {
  if (!data?.system?.dinheiro) return;
  moneySnapshots.set(actor.id, foundry.utils.deepClone(actor.system?.dinheiro ?? {}));
});

/* Alterações consecutivas (compras em sequência, ajustes na ficha) são
 * AGRUPADAS: o "antes" é congelado na primeira mudança e o cartão só sai
 * depois de uma pausa, com o delta total do período. */
const alteracoesPendentes = new Map(); // actorId -> { antes, timer }
const JANELA_AGRUPAMENTO_MS = 3000;

Hooks.on('updateActor', (actor, data, options, userId) => {
  if (!data?.system?.dinheiro) return;

  /* Transações da própria loja (compra/venda/construção/aprimoramento)
   * já publicam o próprio cartão — o monitor ignora esses updates para
   * não duplicar mensagens. */
  if (options?.t20lojaInterno) {
    moneySnapshots.delete(actor.id);
    return;
  }

  // Só o cliente que INICIOU o update publica (evita um card por cliente)
  if (game.user.id !== userId) {
    moneySnapshots.delete(actor.id);
    return;
  }

  const monitorAll = game.settings.get(MODULE_ID, 'monitorAllMoneyChanges');
  const monitorPlayers = game.settings.get(MODULE_ID, 'monitorPlayerMoneyChanges');
  if (!monitorAll && !monitorPlayers) return;

  const user = game.users.get(userId);
  if (!monitorAll && user?.isGM) return;

  const previous = moneySnapshots.get(actor.id);
  moneySnapshots.delete(actor.id);

  let pendente = alteracoesPendentes.get(actor.id);
  if (!pendente) {
    if (!previous) return;
    pendente = { antes: previous };
    alteracoesPendentes.set(actor.id, pendente);
  }
  clearTimeout(pendente.timer);

  pendente.timer = setTimeout(() => {
    alteracoesPendentes.delete(actor.id);
    const atorAtual = game.actors.get(actor.id);
    if (!atorAtual) return;

    const antes = pendente.antes;
    const current = atorAtual.system?.dinheiro ?? {};
    const delta = {
      tl: (current.tl || 0) - (antes.tl || 0),
      to: (current.to || 0) - (antes.to || 0),
      tp: (current.tp || 0) - (antes.tp || 0),
      tc: (current.tc || 0) - (antes.tc || 0),
    };
    if (delta.tl === 0 && delta.to === 0 && delta.tp === 0 && delta.tc === 0) return;

    const mostrarTl = atorUsaPlatina(atorAtual);
    const messageContent = cartaoLoja({
      icone: 'fa-coins',
      titulo: 'alterou as moedas',
      ator: atorAtual.name,
      corpo: `
        ${linhaCartao('Antes', moedasChips(antes, { ocultarZeros: false, mostrarTl }))}
        ${linhaCartao('Alteração', moedasChips(delta, { delta: true, mostrarTl }))}`,
      saldo: current,
      mostrarTl
    });

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: atorAtual }),
      content: messageContent,
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
    });
  }, JANELA_AGRUPAMENTO_MS);
});
