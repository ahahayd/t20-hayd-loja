/**
 * Ator "Mercador": tipo de ator próprio do módulo, com uma ficha que só
 * configura a loja.
 *
 * Por que um tipo próprio, e não um NPC marcado: o token de um NPC costuma
 * ficar desvinculado, e aí o estoque do token no mapa e o do ator na aba de
 * atores viram dois estoques diferentes. O Mercador sempre tem o token
 * vinculado ao ator, então só existe um estoque e um caixa.
 *
 * Quem não é dono do mercador nunca vê a ficha: abrir o ator (dois cliques
 * na aba de atores ou no token) abre a loja dele.
 */

import { MODULE_ID, abrirLojaDoMercador } from './main.js';
import { getShopItems, cartaoLoja, linhaCartao, moedasChips, precoDisplay } from './shop-app.js';
import {
  TIPO_MERCADOR, COMUNIDADES, configPadrao, configMercador, gerarEstoque, itensDoEstoque,
  itemIlimitado, caixaEmCobre, qtdEmEstoque, TIPOS_ESTOQUE, precoDaPeca,
} from './mercador.mjs';

/* ─────────────────────────────────────────────
   Dados do ator
───────────────────────────────────────────── */

const { NumberField, SchemaField, HTMLField } = foundry.data.fields;
const moeda = () => new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 });

/** O mercador só precisa de dinheiro (o caixa) e de uma descrição. */
export class MercadorDados extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      dinheiro: new SchemaField({ tc: moeda(), tp: moeda(), to: moeda(), tl: moeda() }),
      descricao: new HTMLField({ required: false, blank: true, initial: '' }),
    };
  }
}

/** Registra o tipo, a ficha e as regras de criação. Chamado no init. */
export function registrarTipoMercador() {
  CONFIG.Actor.dataModels[TIPO_MERCADOR] = MercadorDados;
  CONFIG.Actor.typeLabels ??= {};
  CONFIG.Actor.typeLabels[TIPO_MERCADOR] = 'TYPES.Actor.t20-hayd-loja.mercador';
  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[TIPO_MERCADOR] = 'fa-solid fa-shop';

  const Config = foundry.applications?.apps?.DocumentSheetConfig ?? globalThis.DocumentSheetConfig;
  Config.registerSheet(Actor, MODULE_ID, MercadorFicha, {
    types: [TIPO_MERCADOR],
    makeDefault: true,
    label: 'Ficha de Mercador',
  });

  // Mercador novo: todos veem (para abrir a loja), token sempre vinculado.
  Hooks.on('preCreateActor', (ator, dados) => {
    if (ator.type !== TIPO_MERCADOR) return;
    const mudar = {
      'prototypeToken.actorLink': true,
      'prototypeToken.disposition': CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    };
    if (dados.ownership?.default === undefined) mudar['ownership.default'] = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
    if (!dados.img || dados.img === CONFIG.Actor.documentClass.DEFAULT_ICON) mudar.img = 'icons/environment/settlement/market-stall.webp';
    if (!foundry.utils.getProperty(dados, `flags.${MODULE_ID}.mercador`)) mudar[`flags.${MODULE_ID}.mercador`] = configPadrao('vila');
    ator.updateSource(mudar);
  });

  // Mesmo um token arrastado de um ator antigo, ou com o vínculo desligado à
  // mão, nasce vinculado: o estoque do mapa é o estoque do ator.
  Hooks.on('preCreateToken', (token, dados) => {
    const ator = game.actors.get(dados.actorId ?? token.actorId);
    if (ator?.type === TIPO_MERCADOR && !token.actorLink) token.updateSource({ actorLink: true });
  });
  Hooks.on('preUpdateToken', (token, mudanca) => {
    if (token.actor?.type === TIPO_MERCADOR && mudanca.actorLink === false) mudanca.actorLink = true;
  });
}

/* ─────────────────────────────────────────────
   Ficha
───────────────────────────────────────────── */

const ActorSheetV1 = foundry.appv1?.sheets?.ActorSheet ?? globalThis.ActorSheet;

export class MercadorFicha extends ActorSheetV1 {
  constructor(...args) {
    super(...args);
    this._substituir = true;
    this._rolarCaixa = true;
    this._sortimento = null;
    this._filtro = '';
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/mercador.hbs`,
      width: 660,
      height: 760,
      resizable: true,
      // Ficha não passa pelo renderApplication no v13: as classes da família vêm daqui.
      classes: ['t20-loja-settings', 't20-loja-mercador', 'sheet', 'actor', 'hayd-ui', 'hayd-ui-escuro'],
      tabs: [{ navSelector: '.mc-abas', contentSelector: '.mc-conteudo', initial: 'estoque' }],
      scrollY: ['.mc-aba'],
      dragDrop: [{ dragSelector: '.mc-item', dropSelector: null }],
      submitOnChange: true,
      closeOnSubmit: false,
    });
  }

  get title() { return `Mercador: ${this.actor.name}`; }

  /**
   * Quem não é dono não vê a ficha: abrir o mercador abre a loja dele.
   * Vale para os dois cliques na aba de atores e no token.
   */
  render(force = false, options = {}) {
    if (!this.actor.isOwner) {
      if (force) abrirLojaDoMercador(this.actor);
      return this;
    }
    return super.render(force, options);
  }

  get cfg() { return configMercador(this.actor) ?? configPadrao('vila'); }

  async getData(options) {
    const data = await super.getData(options);
    const cfg = this.cfg;
    const def = COMUNIDADES[cfg.comunidade];
    const catalogo = await getShopItems().catch(() => []);
    const precoDe = precoDaPeca(catalogo);
    const d = this.actor.system?.dinheiro ?? {};

    const pecas = this.actor.items
      .filter(i => TIPOS_ESTOQUE.has(i.type))
      .map(i => {
        const preco = precoDe(i);
        const qtd = qtdEmEstoque(i);
        return {
          id: i.id,
          nome: i.name,
          busca: i.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(),
          img: i.img,
          ilimitado: itemIlimitado(i),
          qtd: qtd === Infinity ? '' : qtd,
          zerado: qtd === 0,
          preco: preco > 0 ? precoDisplay(preco) : null,
          precoDoCatalogo: preco > 0 && !(Number(i.system?.preco) > 0),
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const aVenda = itensDoEstoque(this.actor);
    const sortimento = this._sortimento ?? def?.gerar.sortimento ?? 40;

    return {
      ...data,
      ator: this.actor,
      cfg,
      def,
      comunidades: Object.entries(COMUNIDADES).map(([chave, c]) => ({ chave, ...c, ativa: chave === cfg.comunidade })),
      pecas,
      filtro: this._filtro,
      semPreco: pecas.filter(p => !p.preco).length,
      estoque: {
        tipos: aVenda.length,
        pecas: aVenda.reduce((s, i) => s + (itemIlimitado(i) ? 0 : qtdEmEstoque(i)), 0),
        ilimitados: aVenda.filter(itemIlimitado).length,
      },
      caixa: moedasChips({ to: d.to, tp: d.tp, tc: d.tc }, { ocultarZeros: false }),
      caixaTP: (caixaEmCobre(this.actor) / 10).toLocaleString('pt-BR'),
      precoMax: cfg.catalogo.precoMax ?? '',
      substituir: this._substituir,
      rolarCaixa: this._rolarCaixa,
      sortimento,
      usaSortimento: !!def?.gerar.comuns,
      caixaFormula: def?.caixa.ilimitado ? 'ilimitado' : `${def?.caixa.formula?.replace('*', '×')} T$`,
    };
  }

  /** Lê os campos de configuração (data-campo) e grava no ator. */
  async _salvarCampos(html) {
    const el = html[0] ?? html;
    const v = campo => el.querySelector(`[data-campo="${campo}"]`);
    const cfg = foundry.utils.deepClone(this.cfg);
    cfg.ativo = v('ativo').checked;
    cfg.sempreAMostra = v('sempreAMostra').checked;
    cfg.catalogo.ativo = v('catalogo').checked;
    const teto = v('precoMax').value.trim();
    cfg.catalogo.precoMax = teto === '' ? null : Math.max(0, Number(teto) || 0);
    cfg.catalogo.excluirRaros = v('excluirRaros').checked;
    cfg.catalogo.magias = v('magias').checked;
    cfg.caixaIlimitado = v('caixaIlimitado').checked;
    cfg.aceitaVenda = v('aceitaVenda').checked;
    cfg.superiores = v('superiores').checked;
    cfg.precoCompra = Math.min(500, Math.max(0, Number(v('precoCompra').value) || 0));
    cfg.precoVenda = Math.min(100, Math.max(0, Number(v('precoVenda').value) || 0));
    await this.actor.setFlag(MODULE_ID, 'mercador', cfg);
  }

  /** Opções de "Gerar estoque": não são gravadas, valem para esta ficha. */
  _lerGeracao(html) {
    const el = html[0] ?? html;
    this._substituir = el.querySelector('[data-gerar="substituir"]')?.checked ?? this._substituir;
    this._rolarCaixa = el.querySelector('[data-gerar="rolarCaixa"]')?.checked ?? this._rolarCaixa;
    const sort = el.querySelector('[data-gerar="sortimento"]');
    if (sort) this._sortimento = Math.min(100, Math.max(1, Number(sort.value) || 1));
  }

  /** Esconde as linhas que não batem com o filtro, sem redesenhar. */
  _aplicarFiltro(html) {
    const q = this._filtro.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
    for (const linha of (html[0] ?? html).querySelectorAll('.mc-item')) {
      const nome = linha.dataset.busca ?? '';
      linha.hidden = !!q && !nome.includes(q);
    }
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._aplicarFiltro(html);
    if (!this.isEditable) return;

    html.find('[data-campo]').on('change', ev => { ev.stopPropagation(); this._salvarCampos(html); });
    html.find('[data-gerar]').on('change', ev => { ev.stopPropagation(); this._lerGeracao(html); });

    // Escolher a comunidade aplica a regra dela (os campos seguem editáveis).
    html.find('[data-comunidade]').on('click', async ev => {
      const chave = ev.currentTarget.dataset.comunidade;
      const c = COMUNIDADES[chave];
      const cfg = foundry.utils.mergeObject(this.cfg, {
        comunidade: chave,
        catalogo: { ...c.catalogo },
        caixaIlimitado: c.caixa.ilimitado,
        superiores: c.superiores,
      }, { inplace: false });
      this._sortimento = c.gerar.sortimento || this._sortimento;
      await this.actor.setFlag(MODULE_ID, 'mercador', cfg);
    });

    html.find('.mc-filtro').on('input', ev => {
      this._filtro = ev.currentTarget.value;
      this._aplicarFiltro(html);
    });

    // Linhas do estoque
    const peca = ev => this.actor.items.get(ev.currentTarget.closest('[data-item-id]')?.dataset.itemId);
    html.find('.mc-item-qtd').on('change', ev => {
      ev.stopPropagation();
      const item = peca(ev);
      const n = Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0));
      item?.update({ 'system.qtd': n });
    });
    html.find('.mc-item-inf').on('click', ev => {
      const item = peca(ev);
      item?.setFlag(MODULE_ID, 'ilimitado', !itemIlimitado(item));
    });
    html.find('.mc-item-abrir').on('click', ev => peca(ev)?.sheet.render(true));
    html.find('.mc-item-apagar').on('click', ev => peca(ev)?.delete());

    html.find('.mc-ilimitar').on('click', async () => {
      const itens = itensDoEstoque(this.actor);
      const todos = itens.every(itemIlimitado);
      await this.actor.updateEmbeddedDocuments('Item', itens.map(i => ({ _id: i.id, [`flags.${MODULE_ID}.ilimitado`]: !todos })));
    });

    html.find('.mc-ver-loja').on('click', () => abrirLojaDoMercador(this.actor));

    html.find('.mc-gerar').on('click', ev => this._gerar(html, ev.currentTarget));
  }

  async _gerar(html, botao) {
    this._lerGeracao(html);
    const cfg = this.cfg;
    const def = COMUNIDADES[cfg.comunidade];
    if (this._substituir && this.actor.items.some(i => TIPOS_ESTOQUE.has(i.type))) {
      const ok = await Dialog.confirm({
        title: 'Substituir estoque?',
        content: `<p>O estoque atual de <b>${this.actor.name}</b> (armas, equipamentos, consumíveis e tesouros) será apagado e trocado pelo novo.</p>`,
      });
      if (!ok) return;
    }
    botao.disabled = true;
    botao.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rolando…';
    try {
      const catalogo = await getShopItems();
      const r = await gerarEstoque(this.actor, catalogo, {
        substituir: this._substituir, comunidade: cfg.comunidade, sortimento: this._sortimento ?? def.gerar.sortimento, rolarCaixa: this._rolarCaixa,
      });
      const corpo = [
        linhaCartao('Comunidade', `<b>${def.rotulo}</b>`),
        ...r.linhas.map(l => linhaCartao('Estoque', l)),
        r.caixa ? linhaCartao('Caixa', r.caixa) : '',
        cfg.catalogo.ativo ? linhaCartao('Encomendas', cfg.catalogo.precoMax
          ? `sem limite até T$ ${Number(cfg.catalogo.precoMax).toLocaleString('pt-BR')}`
          : 'sem limite de preço') : '',
      ].join('');
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: cartaoLoja({ icone: def.icone, titulo: 'abriu a loja com estoque novo', ator: this.actor.name, corpo }),
        whisper: game.users.filter(u => u.isGM).map(u => u.id),
      });
      ui.notifications.info(`${this.actor.name}: ${r.adicionados} item(ns) no estoque.`);
    } catch (err) {
      console.error(`${MODULE_ID} | Falha ao gerar estoque`, err);
      ui.notifications.error('Não foi possível gerar o estoque (veja o console).');
    } finally {
      if (this.rendered) this.render();
    }
  }

  /** Item solto na ficha: empilha com a mesma peça em vez de duplicar. */
  async _onDropItemCreate(itemData) {
    const lista = (Array.isArray(itemData) ? itemData : [itemData]).filter(d => TIPOS_ESTOQUE.has(d.type));
    if (!lista.length) {
      ui.notifications.warn('Mercadores vendem armas, equipamentos, consumíveis e tesouros.');
      return [];
    }
    const criar = [];
    for (const dados of lista) {
      const igual = this.actor.items.find(i => i.type === dados.type && i.name === dados.name
        && !i.getFlag(MODULE_ID, 'aprimoramentos') && !dados.flags?.[MODULE_ID]?.aprimoramentos);
      const qtd = Math.max(1, Number(dados.system?.qtd) || 1);
      if (igual && !itemIlimitado(igual)) await igual.update({ 'system.qtd': qtdEmEstoque(igual) + qtd });
      else if (!igual) criar.push(dados);
    }
    return criar.length ? this.actor.createEmbeddedDocuments('Item', criar) : [];
  }
}

