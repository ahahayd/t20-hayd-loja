/**
 * ShopSettingsApplication — Janela de configuração das fontes da loja.
 * Permite adicionar/remover compêndios extras e itens individuais por UUID.
 */

import { MODULE_ID } from './main.js';
import { warmShopItemsCache } from './shop-app.js';

/** Compêndio de origem do sistema? (tem opção própria nas configurações) */
function ehDoSistema(pack) {
  return pack.metadata.packageType === 'system' || pack.metadata.packageName === game.system.id;
}

/** Quantos itens a loja venderia (com preço) e quantas magias o compêndio tem. */
async function contarVendaveis(pack) {
  const indice = await pack.getIndex({ fields: ['system.preco'] });
  const c = { itens: 0, magias: 0 };
  for (const e of indice) {
    if (e.type === 'magia' || e.type === 'spell') c.magias++;
    else if (Number(e.system?.preco) > 0) c.itens++;
  }
  return c;
}

export class ShopSettingsApplication extends FormApplication {
  _contagens = new Map();


  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id        : 't20-loja-settings',
      title     : 'Configurações da Loja — Fontes de Itens',
      template: `modules/t20-hayd-loja/templates/shop-settings.hbs`,
      width     : 560,
      height    : 'auto',
      resizable : false,
      classes   : ['t20-loja-settings'],
    });
  }

  /* ── getData ────────────────────────────────── */
  async getData() {
    const extraCompendiums = game.settings.get(MODULE_ID, 'extraCompendiums') || [];
    const extraItems       = game.settings.get(MODULE_ID, 'extraItems')       || [];

    // Estado ainda não salvo das caixas: sobrevive aos render() dos itens.
    this._sel ??= new Set(extraCompendiums);

    // Só módulos e mundo: os compêndios do sistema têm opção própria.
    const packs = game.packs.filter(p => p.documentName === 'Item' && p.visible && !ehDoSistema(p));
    await Promise.all(packs.filter(p => !this._contagens.has(p.collection)).map(async p => {
      try { this._contagens.set(p.collection, await contarVendaveis(p)); }
      catch { this._contagens.set(p.collection, null); }
    }));

    const grupos = { modulo: [], mundo: [] };
    for (const p of packs) {
      const c = this._contagens.get(p.collection);
      const chips = [];
      if (c?.itens)  chips.push({ n: c.itens,  rotulo: 'itens à venda', icone: 'fa-sack' });
      if (c?.magias) chips.push({ n: c.magias, rotulo: 'magias',        icone: 'fa-wand-sparkles' });
      grupos[p.metadata.packageType === 'world' ? 'mundo' : 'modulo'].push({
        id    : p.collection,
        rotulo: p.metadata.label,
        pacote: p.metadata.packageType === 'module'
          ? (game.modules.get(p.metadata.packageName)?.title ?? p.metadata.packageName) : '',
        ligado: this._sel.has(p.collection),
        chips,
      });
    }
    const ordenar = l => l.sort((x, y) => (x.pacote + x.rotulo).localeCompare(y.pacote + y.rotulo, 'pt-BR'));
    const gruposLista = [
      { titulo: 'Módulos',             icone: 'fa-puzzle-piece', itens: ordenar(grupos.modulo) },
      { titulo: 'Compêndios do mundo', icone: 'fa-globe',        itens: ordenar(grupos.mundo) },
    ].filter(g => g.itens.length);

    // Enriquece UUIDs com nomes (assíncrono)
    const configuredItems = await Promise.all(
      extraItems.map(async uuid => {
        try {
          const doc = await fromUuid(uuid);
          return { uuid, name: doc?.name ?? uuid, valid: !!doc };
        } catch {
          return { uuid, name: uuid, valid: false };
        }
      })
    );

    return {
      grupos: gruposLista,
      configuredItems,
    };
  }

  /* ── _updateObject ──────────────────────────── */
  async _updateObject(_event, _formData) {
    // Salvo via botões específicos, não pelo submit padrão
  }

  /* ── Listeners ──────────────────────────────── */
  activateListeners(html) {
    super.activateListeners(html);
    // Janela de configuração segue o estilo padrão do Foundry, sem tema da loja.

    // ── Compêndios ──
    const caixas = () => [...html.find('input[data-pack]')];
    html.find('input[data-pack]').on('change', ev => {
      const { pack } = ev.currentTarget.dataset;
      if (ev.currentTarget.checked) this._sel.add(pack); else this._sel.delete(pack);
    });
    const marcar = valor => {
      for (const cb of caixas()) { cb.checked = valor; cb.dispatchEvent(new Event('change')); }
    };
    html.find('#btn-all-packs').on('click', () => marcar(true));
    html.find('#btn-none-packs').on('click', () => marcar(false));

    html.find('#btn-save').on('click', async () => {
      // Compêndios que a lista não mostra (sistema, módulo desligado) ficam como estão.
      const mostrados = new Set(caixas().map(cb => cb.dataset.pack));
      const atual = game.settings.get(MODULE_ID, 'extraCompendiums') || [];
      const lista = [...atual.filter(id => !mostrados.has(id)), ...caixas().filter(cb => cb.checked).map(cb => cb.dataset.pack)];
      await game.settings.set(MODULE_ID, 'extraCompendiums', lista);
      warmShopItemsCache();
      ui.notifications.info('Fontes da loja salvas.');
      this.close();
    });

    // ── Itens individuais ──
    // Adicionar item por UUID
    html.find('#btn-add-item').on('click', async () => {
      const input = html.find('#item-uuid-input')[0];
      const uuid  = input?.value?.trim();
      if (!uuid) return ui.notifications.warn('Informe um UUID válido.');

      // Tenta validar
      let doc;
      try { doc = await fromUuid(uuid); } catch { /* */ }
      if (!doc) return ui.notifications.warn(`UUID não encontrado: ${uuid}`);
      if (doc.documentName !== 'Item') return ui.notifications.warn('O UUID informado não é um Item.');

      const list = game.settings.get(MODULE_ID, 'extraItems') || [];
      if (list.includes(uuid)) return ui.notifications.warn('Este item já está na lista.');
      list.push(uuid);
      await game.settings.set(MODULE_ID, 'extraItems', list);
      warmShopItemsCache();
      if (input) input.value = '';
      this.render();
    });

    // Remover item
    html.find('.btn-remove-item').on('click', async ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      const list = (game.settings.get(MODULE_ID, 'extraItems') || []).filter(u => u !== uuid);
      await game.settings.set(MODULE_ID, 'extraItems', list);
      warmShopItemsCache();
      this.render();
    });

    // Limpar tudo
    html.find('#btn-clear-items').on('click', async () => {
      const ok = await Dialog.confirm({
        title  : 'Limpar itens?',
        content: '<p>Remover todos os itens individuais configurados?</p>',
      });
      if (ok) {
        await game.settings.set(MODULE_ID, 'extraItems', []);
        warmShopItemsCache();
        this.render();
      }
    });
  }
}
