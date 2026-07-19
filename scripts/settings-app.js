/**
 * ShopSettingsApplication — Janela de configuração das fontes da loja.
 * Permite adicionar/remover compêndios extras e itens individuais por UUID.
 */

import { MODULE_ID, aplicarTemaLoja } from './main.js';
import { warmShopItemsCache } from './shop-app.js';

export class ShopSettingsApplication extends FormApplication {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id        : 't20-loja-settings',
      title     : 'Configurações da Loja — Fontes de Itens',
      template: `modules/t20-hayd-loja/templates/shop-settings.hbs`,
      width     : 600,
      height    : 'auto',
      resizable : false,
      classes   : ['t20-loja-settings'],
    });
  }

  /* ── getData ────────────────────────────────── */
  async getData() {
    const extraCompendiums = game.settings.get(MODULE_ID, 'extraCompendiums') || [];
    const extraItems       = game.settings.get(MODULE_ID, 'extraItems')       || [];

    // Monta lista de todos os compêndios de Itens disponíveis (para o select)
    const availablePacks = game.packs
      .filter(p => p.documentName === 'Item')
      .map(p => ({
        id      : p.collection,
        label   : `${p.metadata.label} [${p.collection}]`,
        selected: extraCompendiums.includes(p.collection),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Enriquece compêndios configurados com labels
    const configuredPacks = extraCompendiums.map(id => {
      const pack = game.packs.get(id);
      return {
        id,
        label: pack ? `${pack.metadata.label} [${id}]` : `⚠ Não encontrado: ${id}`,
        valid: !!pack,
      };
    });

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
      availablePacks,
      configuredPacks,
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
    aplicarTemaLoja(this);

    // ── Compêndios ──
    // Adicionar compêndio selecionado
    html.find('#btn-add-pack').on('click', async () => {
      const select = html.find('#pack-select')[0];
      const id = select?.value;
      if (!id) return;

      const list = game.settings.get(MODULE_ID, 'extraCompendiums') || [];
      if (list.includes(id)) {
        return ui.notifications.warn('Este compêndio já está na lista.');
      }
      list.push(id);
      await game.settings.set(MODULE_ID, 'extraCompendiums', list);
      warmShopItemsCache();
      this.render();
    });

    // Remover compêndio
    html.find('.btn-remove-pack').on('click', async ev => {
      const id   = ev.currentTarget.dataset.id;
      const list = (game.settings.get(MODULE_ID, 'extraCompendiums') || []).filter(p => p !== id);
      await game.settings.set(MODULE_ID, 'extraCompendiums', list);
      warmShopItemsCache();
      this.render();
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
    html.find('#btn-clear-packs').on('click', async () => {
      const ok = await Dialog.confirm({
        title  : 'Limpar compêndios?',
        content: '<p>Remover todos os compêndios configurados?</p>',
      });
      if (ok) {
        await game.settings.set(MODULE_ID, 'extraCompendiums', []);
        warmShopItemsCache();
        this.render();
      }
    });

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
