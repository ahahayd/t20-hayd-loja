/**
 * t20-loja — Módulo de Loja para Tormenta20 no FoundryVTT
 * Ponto de entrada principal.
 */

import './hayd-ui-base.mjs';
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

/** Temas oferecidos, na ordem em que aparecem para o usuário. */
export const TEMAS = {
  desativado: { rotulo: 'Desativado (visual padrão do Foundry)' },
  tenda     : { rotulo: 'Tenda medieval', classe: 'tema-tenda' },
  hayd      : { rotulo: 'T20 Hayd UI', classe: 'tema-hayd', exige: 't20-hayd-ui' },
};

/**
 * Tema padrão: Tenda medieval, sempre.
 *
 * Antes dependia do t20-hayd-ui: com ele ativo o padrão era 'hayd', sem
 * ele era 'desativado' — ou seja, quem instalasse só a loja caía no
 * visual cru do Foundry e nunca descobria que havia tema. A Tenda não
 * exige módulo nenhum (as texturas são SVG gerado aqui dentro), então
 * serve de padrão em qualquer mundo.
 *
 * Isto só vale para mundos que NUNCA gravaram a configuração: o Foundry
 * usa o default apenas na ausência de valor. Quem já abriu a loja antes
 * continua no tema que estava, e troca pelo botão "Alterar tema".
 */
export function temaPadrao() {
  return 'tenda';
}

/**
 * Tema visual escolhido nas configurações do módulo, já resolvido:
 * uma das chaves de TEMAS. Um tema cujo módulo exigido não está ativo
 * cai para 'desativado'. 'padrao' é o nome antigo de 'desativado' e
 * continua sendo aceito em mundos salvos antes da renomeação.
 */
export function temaLoja() {
  let escolha = null;
  try { escolha = game.settings.get(MODULE_ID, 'temaVisual'); }
  catch (_e) { /* chamado antes do registro da configuração */ }
  if (escolha === 'padrao') return 'desativado';
  const tema = TEMAS[escolha];
  if (!tema) return 'desativado';
  if (tema.exige && !game.modules?.get(tema.exige)?.active) return 'desativado';
  return escolha;
}

/**
 * O lampião está ligado? O try existe pelo mesmo motivo do temaLoja():
 * isto é consultado em render, e um render pode acontecer antes de o
 * registro das configurações ter rodado. Na dúvida, ligado.
 */
export function lampiaoLigado() {
  try { return game.settings.get(MODULE_ID, 'lampiao') !== false; }
  catch (_e) { return true; }
}

/** Re-renderiza as janelas da loja abertas, para um ajuste de aparência
 *  aparecer sem o mestre ter de fechar e abrir tudo. */
export function rerenderJanelasLoja() {
  for (const app of Object.values(ui.windows)) {
    const el = app.element?.[0];
    if (el?.classList.contains('t20-loja-window') || el?.classList.contains('t20-loja-settings')) {
      app.render(false);
    }
  }
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
 * Aplica (ou remove) o tema escolhido na janela de uma Application V1.
 * No tema Hayd a cor de destaque segue o ator que está usando a loja
 * (cor do jogador dono, como no t20-hayd-ui). Sem o t20-hayd-ui, o
 * visual fica o padrão neutro do Foundry.
 */
export function aplicarTemaLoja(app, ator = null) {
  const el = app.element?.[0];
  if (!el) return;
  const tema = temaLoja();
  for (const [chave, def] of Object.entries(TEMAS)) {
    if (def.classe) el.classList.toggle(def.classe, tema === chave);
  }
  el.classList.toggle('loja-sem-lampiao', !lampiaoLigado());
  if (tema === 'hayd') el.style.setProperty('--loja-destaque', corDestaqueAtor(ator));
  else el.style.removeProperty('--loja-destaque');
  // O ajuste automático de contraste existe por causa da cor de destaque
  // variável do tema Hayd. Os outros temas têm paleta fixa e já conferida,
  // então ficam de fora (nos gradientes do tema Tenda o cálculo de fundo
  // efetivo erraria e inverteria o texto dos botões).
  const corrigirContraste = () => {
    if (temaLoja() === 'hayd') ajustarContrasteLoja(el);
    else limparContrasteLoja(el);
  };
  requestAnimationFrame(corrigirContraste);
  if (!el.dataset.contrasteObs) {
    el.dataset.contrasteObs = '1';
    // Mudanças de classe/estilo (ex.: botão ativo) sem re-render
    let pendente = false;
    new MutationObserver(() => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => { pendente = false; corrigirContraste(); });
    }).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  }
}

/* ─────────────────────────────────────────────
   Seletor rápido de tema (botão no cabeçalho da loja)
───────────────────────────────────────────── */

/**
 * Diálogo de troca de tema. A configuração é de mundo, então quem não
 * é mestre só recebe o aviso — o botão também não é oferecido a ele.
 * Um tema cujo módulo exigido não está ativo aparece desabilitado, com
 * o motivo escrito, em vez de sumir: assim quem procura entende por quê.
 */
export function escolherTemaLoja() {
  if (!game.user?.isGM) {
    ui.notifications.warn('Só o mestre pode alterar o tema da loja.');
    return;
  }
  const atual = temaLoja();
  // O valor gravado pode diferir do resolvido (ex.: 'hayd' gravado com o
  // t20-hayd-ui desativado). É ele que o Cancelar restaura.
  const salvo = game.settings.get(MODULE_ID, 'temaVisual');
  const lampiaoSalvo = lampiaoLigado();
  // O lampião só existe no tema Tenda, então mora na linha dele, e não
  // numa seção própria: assim o escopo da opção se lê sozinho.
  //
  // Os dois controles são IRMÃOS dentro da linha, nunca um <label>
  // dentro do outro: label aninhada é inválida, e o clique no checkbox
  // marcaria o radio do tema junto.
  const linhas = Object.entries(TEMAS).map(([chave, def]) => {
    const faltando = def.exige && !game.modules?.get(def.exige)?.active;
    const lampiao = chave !== 'tenda' ? '' : `
        <label class="tema-sub" title="Esconde o lampião pendurado no canto da janela da loja.">
          <input type="checkbox" name="semLampiao" ${lampiaoSalvo ? '' : 'checked'}>
          <span>Desativar lampião</span>
        </label>`;
    return `
      <div class="tema-linha">
        <label class="tema-opcao${faltando ? ' tema-indisponivel' : ''}">
          <input type="radio" name="tema" value="${chave}"
                 ${chave === atual ? 'checked' : ''} ${faltando ? 'disabled' : ''}>
          <span>${def.rotulo}</span>
          ${faltando ? `<small>precisa do módulo ${def.exige} ativo</small>` : ''}
        </label>${lampiao}
      </div>`;
  }).join('');

  new Dialog({
    title: 'Tema da loja',
    content: `<div class="t20-loja-tema-dialog">${linhas}</div>`,
    buttons: {
      aplicar: {
        icon: '<i class="fas fa-check"></i>',
        label: 'Aplicar',
        callback: html => {
          const escolha = html.find('input[name="tema"]:checked').val();
          if (escolha) game.settings.set(MODULE_ID, 'temaVisual', escolha);
          const sem = html.find('input[name="semLampiao"]').prop('checked');
          game.settings.set(MODULE_ID, 'lampiao', !sem);
        },
      },
      cancelar: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancelar',
        // A prévia já gravou a escolha; cancelar precisa devolver o valor
        // anterior, senão o botão não cancela nada.
        callback: () => {
          game.settings.set(MODULE_ID, 'temaVisual', salvo);
          game.settings.set(MODULE_ID, 'lampiao', lampiaoSalvo);
        },
      },
    },
    default: 'aplicar',
    render: html => {
      // Marcar uma opção já aplica: dá para ver o tema atrás do diálogo
      // antes de confirmar.
      html.find('input[name="semLampiao"]').on('change', ev => {
        game.settings.set(MODULE_ID, 'lampiao', !ev.currentTarget.checked);
      });
      html.find('input[name="tema"]').on('change', ev => {
        game.settings.set(MODULE_ID, 'temaVisual', ev.currentTarget.value);
      });
    },
  }).render(true);
}

/**
 * Botão "Alterar tema" ao lado do fechar, na vitrine da loja.
 * Devolve a lista de botões do cabeçalho já com ele na frente.
 * Usado pelo _getHeaderButtons de ShopApplication. O carrinho não
 * recebe o botão: ele herda o tema da vitrine que o abriu.
 */
export function botoesCabecalhoComTema(botoes) {
  if (!game.user?.isGM) return botoes;
  botoes.unshift({
    label: 'Alterar tema',
    class: 't20-loja-tema',
    icon: 'fas fa-palette',
    onclick: () => escolherTemaLoja(),
  });
  return botoes;
}

/* ── Contraste automático do texto ── */

function _rgba(str) {
  const m = str?.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}

function _luminancia({ r, g, b }) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function _contraste(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Cor de fundo efetiva: compõe as camadas semitransparentes até achar uma opaca. */
function _fundoEfetivo(node) {
  const camadas = [];
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    const c = _rgba(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) { camadas.push(c); if (c.a >= 1) break; }
  }
  // Base: fundo escuro do tema/janela se nada for opaco
  let cor = { r: 20, g: 18, b: 24 };
  for (const c of camadas.reverse()) {
    cor = { r: c.r * c.a + cor.r * (1 - c.a), g: c.g * c.a + cor.g * (1 - c.a), b: c.b * c.a + cor.b * (1 - c.a) };
  }
  return cor;
}

/** Seletores cujo texto o ajuste de contraste pode sobrescrever. */
const ALVOS_CONTRASTE =
  'button, .wealth-coin, input[type="text"], input[type="number"], input[type="search"], select';

/** Remove as cores forçadas por ajustarContrasteLoja (ao trocar de tema). */
export function limparContrasteLoja(el) {
  for (const alvo of el.querySelectorAll(ALVOS_CONTRASTE)) alvo.style.removeProperty('color');
}

/**
 * Garante leitura em botões, moedas e campos cujo fundo muda com a cor
 * do jogador/tema: se o contraste da cor atual for baixo, troca para
 * claro ou escuro (o que contrastar mais).
 */
export function ajustarContrasteLoja(el) {
  for (const alvo of el.querySelectorAll(ALVOS_CONTRASTE)) {
    alvo.style.removeProperty('color');
    const fundo = _luminancia(_fundoEfetivo(alvo));
    const texto = _rgba(getComputedStyle(alvo).color);
    if (texto && _contraste(fundo, _luminancia(texto)) >= 4.5) continue;
    const claro = _contraste(fundo, 1) >= _contraste(fundo, 0);
    alvo.style.setProperty('color', claro ? '#ffffff' : '#111111', 'important');
  }
}

/* ─────────────────────────────────────────────
   INIT — Registro de configurações
───────────────────────────────────────────── */
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Inicializando módulo Tormenta20 Loja`);

  /* Linhas da tabela da loja: partial usado tanto no render completo quanto
   * na paginação por scroll (que injeta só as linhas novas no tbody). */
  const carregarTemplates = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  carregarTemplates([`modules/${MODULE_ID}/templates/shop-rows.hbs`]);

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

  // Tema visual das janelas da loja. O padrão é o T20 Hayd UI quando
  // esse módulo existe no mundo; sem ele, nenhum tema.
  game.settings.register(MODULE_ID, 'temaVisual', {
    name: 'Tema visual da loja',
    hint: 'Aparência das janelas da loja. O botão "Alterar tema" no cabeçalho da loja muda isto sem passar por aqui. "T20 Hayd UI" exige o módulo t20-hayd-ui ativo no mundo.',
    scope: 'world',
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(TEMAS).map(([k, t]) => [k, t.rotulo])),
    default: temaPadrao(),
    onChange: () => rerenderJanelasLoja(),
  });

  // Lampião decorativo do tema Tenda Medieval. É de mundo, como o tema:
  // a loja é a mesma para todos, e um jogador vendo a lamparina e outro
  // não seria mais confuso que útil. Quem simplesmente não quer
  // movimento na tela já é atendido pelo prefers-reduced-motion.
  game.settings.register(MODULE_ID, 'lampiao', {
    name: 'Lampião da loja',
    hint: 'O lampião pendurado no canto da janela, no tema Tenda Medieval. O botão "Alterar tema" no cabeçalho da loja também liga e desliga isto.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderJanelasLoja(),
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
    hint: 'Paga com as moedas do bolso e recebe o troco em espécie, seguindo o limiar de ouro abaixo. As moedas deixam de ser reorganizadas a cada compra.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Limiar (em TP) a partir do qual o ouro entra nos negócios
  game.settings.register(MODULE_ID, 'limiarTrocoTO', {
    name: 'Troco realista: limiar para usar ouro',
    hint: 'Negócios a partir deste valor (em TP) usam Tibares de Ouro. Abaixo dele, só prata e cobre, salvo falta de prata. Padrão: 1000.',
    scope: 'world',
    config: true,
    type: Number,
    default: 1000
  });

  // Mensagens de compra/venda no chat
  game.settings.register(MODULE_ID, 'enableChatMessages', {
    name: 'Enviar mensagem no chat ao comprar/vender',
    hint: 'Envia mensagem no chat para compras e vendas.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Mensagem apenas para o mestre (whisper)
  game.settings.register(MODULE_ID, 'whisperChatMessages', {
    name: 'Enviar mensagem no chat apenas para o mestre',
    hint: 'Envia as mensagens de compra/venda apenas como whisper para mestres.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'monitorPlayerMoneyChanges', {
    name: 'Monitorar mudanças de moedas feitas por jogadores',
    hint: 'Registra no chat mudanças manuais de moedas feitas por jogadores (mestres e macros não disparam).',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'monitorAllMoneyChanges', {
    name: 'Monitorar mudanças de moedas em todos os casos',
    hint: 'Registra no chat mudanças de moedas mesmo quando mestres ou macros alteram o dinheiro.',
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

  // Atalho de teclado para abrir a loja (padrão: tecla P). Usa o ator do
  // token controlado, senão o personagem atribuído ao usuário — mesmo
  // critério (system.dinheiro) do botão na ficha.
  game.keybindings.register(MODULE_ID, 'openShop', {
    name: 'Abrir Loja',
    hint: 'Abre a loja do token selecionado ou, sem seleção, do seu personagem.',
    editable: [{ key: 'KeyP' }],
    onDown: () => {
      const actor = actorParaAtalhoDaLoja();
      if (!actor) {
        ui.notifications.warn('Selecione um token ou tenha um personagem atribuído para abrir a loja.');
        return true;
      }
      abrirLojaPara(actor);
      return true;
    },
  });
});

/** Mesmo ator que o botão da ficha usaria: token controlado ou personagem
 * atribuído ao usuário, desde que tenha sistema de dinheiro (jogável). */
function actorParaAtalhoDaLoja() {
  for (const token of canvas?.tokens?.controlled ?? []) {
    if (token.actor?.system?.dinheiro) return token.actor;
  }
  const personagem = game.user?.character;
  if (personagem?.system?.dinheiro) return personagem;
  return null;
}

/** Abre a loja para o ator, reaproveitando a janela já aberta (se houver). */
function abrirLojaPara(actor) {
  const existing = Object.values(ui.windows).find(
    w => w instanceof ShopApplication && w.actor.id === actor.id
  );
  if (existing) {
    existing.bringToTop();
  } else {
    new ShopApplication(actor).render(true);
  }
}

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

  // Observadores/limitados não podem comprar pela ficha: só o dono (ou o GM) vê a loja
  if (!actor.isOwner) return;

  // stopImmediatePropagation (e não só stopPropagation): o botão do
  // cabeçalho usa a classe .header-button para herdar o estilo do Foundry,
  // e o Foundry liga o handler dele em todos os .header-button 500 ms
  // depois do render — se a injeção cair dentro dessa janela, ele também
  // escuta o nosso botão, não o encontra em headerButtons e estoura
  // ("Cannot read properties of undefined (reading 'onclick')"). Como o
  // nosso handler é ligado antes, basta impedir os seguintes do elemento.
  const abrir = ev => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    abrirLojaPara(actor);
  };

  // Atalho discreto no fim da fileira de moedas: é onde o jogador está
  // olhando quando pensa em comprar. O corpo da ficha é recriado a cada
  // render, então este entra sempre (o do cabeçalho, abaixo, sobrevive).
  const moedas = html[0]?.querySelector?.('.inventory-currency ul.currency');
  if (moedas && !moedas.querySelector('.t20-loja-atalho')) {
    const li = document.createElement('li');
    li.className = 't20-loja-atalho';
    li.innerHTML = '<a role="button" tabindex="0" aria-label="Abrir Loja" data-tooltip="Abrir Loja">'
      + '<i class="fas fa-store" inert></i></a>';
    const link = li.firstElementChild;
    link.addEventListener('click', abrir);
    link.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') abrir(ev);
    });
    moedas.append(li);
  }

  // Evita duplicar o botão em re-renders
  const janela = html.closest('.app');
  if (janela.find('.t20-loja-btn').length > 0) return;

  const btn = $(`
    <a class="t20-loja-btn header-button control" title="Abrir Loja">
      <i class="fas fa-store"></i>
      <span>Loja</span>
    </a>
  `);
  btn.on('click', abrir);

  // Primeiro dos botões do cabeçalho, longe do fechar: um clique errado no
  // "Loja" não pode fechar a ficha.
  const header = janela.find('.window-header');
  const primeiro = header.find('.header-button').first();
  if (primeiro.length) primeiro.before(btn);
  else header.find('.close').before(btn);
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

/* ── Piso mínimo das janelas (responsividade básica) ──────────
   Solução temporária: em vez de uma responsividade real, as janelas
   redimensionáveis da loja apenas param de encolher num tamanho em que
   o layout ainda se lê. O CSS cuida da parte visual (container queries
   em shop.css); aqui garantimos que o arrasto da alça de resize não
   leve a janela abaixo do piso.

   Precisa ser no setPosition porque a alça de resize do Foundry chama
   setPosition direto com a largura/altura do ponteiro: um min-width no
   CSS corrigiria o visual, mas a posição guardada continuaria menor e
   voltaria errada no próximo render. */
export function pisoDaJanela(app, superSetPosition, posicao = {}, piso = {}) {
  const pos = { ...posicao };
  if (Number.isFinite(pos.width) && Number.isFinite(piso.width)) {
    pos.width = Math.max(pos.width, piso.width);
  }
  if (Number.isFinite(pos.height) && Number.isFinite(piso.height)) {
    pos.height = Math.max(pos.height, piso.height);
  }
  return superSetPosition.call(app, pos);
}

/* ── Classes de largura (responsividade básica) ───────────────
   Media queries olham a viewport, não a janela do app, então não
   servem aqui: duas lojas abertas lado a lado têm larguras
   diferentes na mesma tela. Em vez de container queries (que exigem
   containment no elemento e brigariam com as decorações que vazam da
   janela no tema tenda), um ResizeObserver marca o app com classes de
   faixa e o CSS reage a elas.

   .t20l-estreito        → abaixo de 760px
   .t20l-muito-estreito  → abaixo de 560px */
const FAIXAS_LARGURA = [
  { classe: 't20l-estreito', max: 760 },
  { classe: 't20l-muito-estreito', max: 560 },
];

export function observarLargura(app) {
  // A janela inteira (.app), não o html do template: as classes de faixa são
  // lidas pelo CSS a partir de .t20-loja-window.
  const el = app.element?.[0] ?? app.element;
  if (!el) return;

  const marcar = (largura) => {
    for (const { classe, max } of FAIXAS_LARGURA) el.classList.toggle(classe, largura < max);
  };
  marcar(el.getBoundingClientRect().width);

  // Um observer por janela; o anterior morre junto com o elemento antigo
  // a cada re-render, mas desconectamos à mão para não acumular.
  app._observadorLargura?.disconnect();
  app._observadorLargura = new ResizeObserver((entradas) => {
    marcar(entradas[0].contentRect.width);
  });
  app._observadorLargura.observe(el);
}
