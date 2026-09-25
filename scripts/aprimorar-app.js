/**
 * AprimorarApplication — "Itens Superiores e Encantados".
 *
 * Fluxo em duas etapas na mesma janela:
 *   1. Escolher o item: um item do inventário do ator ou um item da loja
 *      que ele ainda não tem.
 *   2. Escolher melhorias, encantos e materiais especiais do catálogo do
 *      t20-hayd-itens e pagar — comprando (com o percentual da loja) ou
 *      fabricando (1/2 a 1/6 do valor, com desconto de matéria-prima).
 *
 * Preço (mesma regra do t20-hayd-itens): as tabelas de melhorias e
 * encantos são ACUMULADAS, então o custo de adicionar é a diferença entre
 * o preço da quantidade final e o da quantidade que o item já tem. Cada
 * material especial conta como uma melhoria e soma o próprio custo;
 * munições pagam metade (T20 p.178).
 *
 * Com o t20-hayd-itens ATIVO, as entradas entram de verdade no item (aba,
 * efeitos e automações do módulo). Sem ele, o catálogo ainda é lido dos
 * arquivos (se instalados) e as entradas vão para a descrição do item.
 */

import { MODULE_ID, aplicarTemaLoja } from './main.js';
import {
  getShopItems, debitarCarteira, cartaoLoja, linhaCartao, moedasChips, atorUsaPlatina,
  precoDisplay, linhaPagamento, getChatRecipients, toCobre,
} from './shop-app.js';

const ITENS_ID = 't20-hayd-itens';

const FRACOES = [
  { label: '1/2', value: 1 / 2 },
  { label: '1/3', value: 1 / 3 },
  { label: '1/4', value: 1 / 4 },
  { label: '1/5', value: 1 / 5 },
  { label: '1/6', value: 1 / 6 },
];

/* Cópias das tabelas do t20-hayd-itens, usadas só quando o catálogo dele
 * não pode ser carregado. */
function precoMelhoriasLocal(n) {
  if (n <= 0) return 0;
  const oficial = { 1: 300, 2: 3000, 3: 9000, 4: 18000 };
  return oficial[n] ?? 300 * 10 * (((n - 1) * n) / 2);
}
function precoEncantosLocal(n) {
  return n <= 0 ? 0 : 18000 * Math.pow(2, n - 1);
}

/** Catálogo do t20-hayd-itens: importa os arquivos mesmo com o módulo inativo. */
let _catalogo;
async function carregarCatalogo() {
  if (_catalogo !== undefined) return _catalogo;
  try {
    _catalogo = await import(`../../${ITENS_ID}/scripts/catalogo.mjs`);
  } catch (err) {
    console.debug(`${MODULE_ID} | Catálogo do ${ITENS_ID} indisponível`, err);
    _catalogo = null;
  }
  return _catalogo;
}

/** API do t20-hayd-itens, só quando o módulo está ativo e pronto. */
function apiItens() {
  const mod = game.modules.get(ITENS_ID);
  return mod?.active && mod.api?.efeitos ? mod.api : null;
}

function escapar(texto) {
  return foundry.utils.escapeHTML?.(String(texto ?? '')) ?? String(texto ?? '');
}

function formatarCusto(cobre) {
  if (cobre <= 0) return 'Grátis';
  if (cobre < 10) return `${cobre} TC`;
  return precoDisplay(cobre / 10);
}

function ehMunicao(doc) {
  return doc?.type === 'consumivel' && doc.system?.tipo === 'ammo';
}

function elegivel(doc, catalogo) {
  if (catalogo?.itemElegivel) return catalogo.itemElegivel(doc);
  return doc.type === 'arma' || doc.type === 'equipamento' || ehMunicao(doc);
}

/**
 * Quantas melhorias e encantos o item já tem, pelas fontes conhecidas:
 * flags do t20-hayd-itens, flag desta loja e os campos nativos do sistema.
 * Vale o maior valor encontrado em cada tipo.
 */
function detectarExistentes(doc) {
  let m = 0, e = 0;
  const fontes = [];

  const fi = doc.flags?.[ITENS_ID];
  if (fi && (fi.melhorias?.length || fi.encantos?.length || fi.materiais?.length)) {
    m = Math.max(m, (fi.melhorias?.length ?? 0) + (fi.materiais?.length ?? 0));
    e = Math.max(e, fi.encantos?.length ?? 0);
    fontes.push('Itens Superiores (t20-hayd-itens)');
  }

  const fl = doc.flags?.[MODULE_ID]?.aprimoramentos;
  if (fl && (fl.nMelhorias || fl.nEncantos)) {
    m = Math.max(m, Number(fl.nMelhorias) || 0);
    e = Math.max(e, Number(fl.nEncantos) || 0);
    fontes.push('loja');
  }

  const up = doc.system?.upgrades;
  if (up) {
    const nm = ['melhoria1', 'melhoria2', 'melhoria3', 'melhoria4', 'material'].filter(k => up[k]).length;
    const ne = ['encanto1', 'encanto2', 'encanto3'].filter(k => up[k]).length;
    if (nm || ne) {
      m = Math.max(m, nm);
      e = Math.max(e, ne);
      fontes.push('ficha do sistema');
    }
  }

  const chaves = new Set([
    ...(fi?.melhorias ?? []), ...(fi?.encantos ?? []), ...(fi?.materiais ?? []),
  ].map(r => r.key));

  return { m, e, fontes, chaves };
}

/** Bloco de descrição com as entradas aplicadas (sem o t20-hayd-itens). */
function blocoDescricao(entradas) {
  const rotulo = { melhoria: 'Melhoria', encanto: 'Encanto', material: 'Material especial' };
  const linhas = entradas.map(en => `
    <li><strong>${escapar(en.nome)}</strong> <em>(${rotulo[en.tipo] ?? en.tipo})</em></li>`).join('');
  return `<section class="t20-loja-aprimoramentos"><h3>Melhorias e Encantos</h3><ul>${linhas}</ul></section>`;
}

const RE_BLOCO = /<section class="t20-loja-aprimoramentos">[\s\S]*?<\/section>/;

export class AprimorarApplication extends Application {
  constructor(shopApp, options = {}) {
    super(options);
    this.shopApp = shopApp;
    this.actor = shopApp.actor;
    this._etapa = 'escolher';
    this._fonte = 'inventario';
    this._alvo = null;
    this._resetConfig();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `t20-loja-aprimorar-${foundry.utils.randomID(4)}`,
      title: 'Itens Superiores e Encantados',
      width: 720,
      height: 640,
      resizable: true,
      classes: ['t20-loja-window', 't20-loja-aprimorar'],
      scrollY: ['.apr-lista', '.apr-entradas'],
    });
  }

  _resetConfig() {
    this._existM = 0;
    this._existE = 0;
    this._detec = null;
    this._sel = new Set();
    this._custom = [];
    this._todasCats = false;
    this._aba = 'superior';
    this._modo = 'buy';
    this._percent = this.shopApp?._buyPercent ?? 100;
    this._fracao = 1 / 3;
    this._desconto = 0;
  }

  /* ── Dados ─────────────────────────────────── */

  async getData() {
    const catalogo = await carregarCatalogo();
    return this._etapa === 'escolher'
      ? this._dadosEscolha(catalogo)
      : this._dadosConfig(catalogo);
  }

  async _dadosEscolha(catalogo) {
    let linhas;
    if (this._fonte === 'inventario') {
      linhas = this.actor.items
        .filter(i => elegivel(i, catalogo))
        .map(i => {
          const d = detectarExistentes(i);
          return {
            id: i.id, nome: i.name, img: i.img, preco: Number(i.system?.preco) || 0,
            qtd: Number(i.system?.qtd) || 1,
            badge: d.m || d.e ? `${d.m} melh. · ${d.e} enc.` : '',
          };
        });
    } else {
      const loja = await getShopItems();
      const possuidos = new Set(this.actor.items.map(i => i.getFlag(MODULE_ID, 'sourceUuid')).filter(Boolean));
      const nomes = new Set(this.actor.items.map(i => i.name));
      linhas = loja
        .filter(i => i.type === 'arma' || i.type === 'equipamento'
          || (i.type === 'consumivel' && i.filterTags?.includes('cons:ammo')))
        .filter(i => !possuidos.has(i.uuid) && !nomes.has(i.name))
        .map(i => ({ id: i.uuid, nome: i.name, img: i.img, preco: i.preco, qtd: 1, badge: '' }));
    }
    linhas.sort((a, b) => a.nome.localeCompare(b.nome));
    return { etapa: 'escolher', fonte: this._fonte, linhas };
  }

  _dadosConfig(catalogo) {
    const alvo = this._alvo;
    const doc = alvo.doc;
    const detec = this._detec;
    const cats = catalogo?.categoriasDoItem?.(doc) ?? [];
    const serve = def => this._todasCats || (def.cats ?? []).some(c => cats.includes(c));

    const montar = (tabela, tipo) => Object.entries(tabela ?? {})
      .filter(([key, def]) => serve(def) || this._sel.has(key))
      .map(([key, def]) => ({
        key, tipo, nome: def.nome, beneficio: def.beneficio ?? '', fonte: def.fonte ?? '',
        especial: !!def.especial, possui: detec.chaves.has(key), marcado: this._sel.has(key),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const materiais = catalogo
      ? Object.entries(catalogo.obterMateriais())
        .filter(([key, def]) => this._todasCats || catalogo.materialServeNoItem(def, doc) || this._sel.has(key))
        .map(([key, def]) => {
          const variante = catalogo.varianteInicial(def, doc);
          return {
            key, tipo: 'material', nome: def.nome, fonte: def.fonte ?? '',
            beneficio: catalogo.beneficioDaVariante(def, variante),
            custo: catalogo.precoDaVariante(def, variante),
            possui: detec.chaves.has(key), marcado: this._sel.has(key),
          };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome))
      : [];

    return {
      etapa: 'configurar',
      alvo,
      comCatalogo: !!catalogo,
      comApi: !!apiItens(),
      melhorias: catalogo ? montar(catalogo.obterMelhorias(), 'melhoria') : [],
      encantos: catalogo ? montar(catalogo.obterEncantos(), 'encanto') : [],
      materiais,
      avisos: this._avisos(catalogo),
      calc: this._calcular(catalogo),
    };
  }

  /** Entrada selecionada → { tipo, def, custo }. */
  _entradasSelecionadas(catalogo) {
    const out = [];
    if (catalogo) {
      const mats = catalogo.obterMateriais();
      for (const key of this._sel) {
        if (mats[key]) {
          const def = mats[key];
          const variante = catalogo.varianteInicial(def, this._alvo.doc);
          out.push({
            key, tipo: 'material', nome: def.nome, especial: !!def.especial,
            beneficio: catalogo.beneficioDaVariante(def, variante),
            custo: catalogo.precoDaVariante(def, variante),
          });
          continue;
        }
        const def = catalogo.obterEntrada(key);
        if (!def) continue;
        out.push({ key, tipo: def.tipo, nome: def.nome, especial: !!def.especial, beneficio: def.beneficio ?? '', custo: 0 });
      }
    }
    for (const c of this._custom) {
      if (c.nome.trim()) out.push({ key: null, tipo: c.tipo, nome: c.nome.trim(), especial: false, beneficio: c.beneficio.trim(), custo: 0 });
    }
    return out;
  }

  /** Pré-requisitos e conflitos (só avisam — o padrão pode ser quebrado). */
  _avisos(catalogo) {
    if (!catalogo) return [];
    const possui = new Set([...this._detec.chaves, ...this._sel]);
    const avisos = [];
    for (const key of this._sel) {
      const def = catalogo.obterEntrada(key);
      if (!def) continue;
      if (def.prereqs?.length) {
        if (def.prereqs.includes('*')) {
          if (this._existM + this._existE + this._sel.size <= 1) {
            avisos.push(`${def.nome}: exige possuir outra melhoria/encanto.`);
          }
        } else {
          const falta = def.prereqAlternativo
            ? (def.prereqs.some(k => possui.has(k)) ? [] : def.prereqs)
            : def.prereqs.filter(k => !possui.has(k));
          if (falta.length) {
            const nomes = falta.map(k => catalogo.obterEntrada(k)?.nome ?? k);
            avisos.push(`${def.nome}: pré-requisito ${nomes.join(def.prereqAlternativo ? ' ou ' : ', ')}.`);
          }
        }
      }
      const conflito = (def.conflita ?? []).find(k => possui.has(k));
      if (conflito) avisos.push(`${def.nome}: conflita com ${catalogo.obterEntrada(conflito)?.nome ?? conflito}.`);
    }
    return avisos;
  }

  _calcular(catalogo) {
    const alvo = this._alvo;
    const pm = catalogo?.precoMelhorias ?? precoMelhoriasLocal;
    const pe = catalogo?.precoEncantos ?? precoEncantosLocal;
    const mult = alvo.municao ? 0.5 : 1;

    const sel = this._entradasSelecionadas(catalogo);
    const novasM = sel.filter(s => s.tipo === 'melhoria' || s.tipo === 'material').length;
    const novosE = sel.filter(s => s.tipo === 'encanto').length;
    const custoMat = sel.reduce((t, s) => t + (s.tipo === 'material' ? s.custo : 0), 0);

    const eM = this._existM, eE = this._existE;
    const deltaM = (pm(eM + novasM) - pm(eM)) * mult;
    const deltaE = (pe(eE + novosE) - pe(eE)) * mult;
    const deltaMat = custoMat * mult;
    const aumento = deltaM + deltaE + deltaMat;               // valor somado a cada unidade

    const qtd = alvo.qtdAlvo;
    const valorItem = alvo.origem === 'loja' ? alvo.preco : 0; // o item da loja também é pago
    const baseCobre = Math.round((valorItem + aumento) * qtd * 10);

    const custoCobre = this._modo === 'buy'
      ? Math.round(baseCobre * (this._percent / 100))
      : Math.max(0, Math.floor(baseCobre * this._fracao) - Math.round(this._desconto * 10));

    return {
      sel, novasM, novosE, eM, eE, qtd,
      deltaM, deltaE, deltaMat, aumento,
      precoFinal: Math.round((alvo.preco + aumento) * 100) / 100,
      baseCobre, custoCobre,
      totalM: eM + novasM, totalE: eE + novosE,
    };
  }

  /* ── Renderização ──────────────────────────── */

  async _renderInner(data) {
    const html = data.etapa === 'escolher' ? this._htmlEscolha(data) : this._htmlConfig(data);
    return $(`<div class="apr-root">${html}</div>`);
  }

  _htmlEscolha(data) {
    const linhas = data.linhas.map(l => `
      <li class="apr-item" data-id="${l.id}" data-busca="${escapar(l.nome.toLowerCase())}">
        <img src="${l.img}" alt="" />
        <span class="apr-item-nome">${escapar(l.nome)}${l.qtd > 1 ? ` <em>×${l.qtd}</em>` : ''}</span>
        ${l.badge ? `<span class="apr-badge">${l.badge}</span>` : ''}
        <span class="apr-item-preco">${precoDisplay(l.preco)}</span>
      </li>`).join('');
    const vazio = data.fonte === 'inventario'
      ? 'Nenhuma arma, armadura, escudo, equipamento ou munição no inventário.'
      : 'Nenhum item da loja que você ainda não tenha.';
    return `
      <div class="apr-abas">
        <button type="button" data-fonte="inventario" class="${data.fonte === 'inventario' ? 'active' : ''}"><i class="fas fa-suitcase"></i> Meu inventário</button>
        <button type="button" data-fonte="loja" class="${data.fonte === 'loja' ? 'active' : ''}"><i class="fas fa-store"></i> Da loja</button>
      </div>
      <input type="text" class="apr-busca" placeholder="Buscar item…" />
      <ul class="apr-lista">${linhas || `<li class="apr-vazio">${vazio}</li>`}</ul>
      <p class="apr-dica">Escolha o item que vai receber melhorias, encantos ou material especial.</p>`;
  }

  _htmlConfig(data) {
    const { alvo, calc } = data;
    const detec = this._detec;

    const linhaEntrada = en => `
      <label class="apr-entrada ${en.possui ? 'possui' : ''}" data-busca="${escapar(en.nome.toLowerCase())}" title="${escapar(en.fonte)}">
        <input type="checkbox" data-key="${en.key}" ${en.marcado ? 'checked' : ''} ${en.possui ? 'disabled' : ''} />
        <span class="apr-entrada-nome">${escapar(en.nome)}</span>
        ${en.custo !== undefined ? `<span class="apr-entrada-custo">+${precoDisplay(en.custo * (alvo.municao ? 0.5 : 1))}</span>` : ''}
        <span class="apr-entrada-benef">${en.possui ? '<em>Já possui</em> · ' : ''}${escapar(en.beneficio)}</span>
      </label>`;
    // Uma aba por lista: Item Superior, Material Especial, Item Encantado
    const grupos = [
      { classe: 'superior', icone: 'fa-hammer', titulo: 'Item Superior', dica: 'Melhorias', lista: data.melhorias },
      { classe: 'material', icone: 'fa-gem', titulo: 'Material Especial', dica: 'Conta como melhoria', lista: data.materiais },
      { classe: 'encanto', icone: 'fa-wand-sparkles', titulo: 'Item Encantado', dica: 'Encantos', lista: data.encantos },
    ];
    // Materiais sem preço tabelado (raros, sob consulta) vão para o fim
    const listaDoGrupo = g => {
      if (g.classe !== 'material') return g.lista.map(linhaEntrada).join('');
      const comPreco = g.lista.filter(en => en.custo > 0);
      const semPreco = g.lista.filter(en => !(en.custo > 0));
      return comPreco.map(linhaEntrada).join('')
        + (semPreco.length ? `<div class="apr-separador"><span>Não compráveis</span></div>${semPreco.map(linhaEntrada).join('')}` : '');
    };
    const abas = grupos.map(g => {
      const marcados = g.lista.filter(en => en.marcado).length;
      return `<button type="button" class="apr-aba apr-grupo-${g.classe} ${this._aba === g.classe ? 'active' : ''}" data-aba="${g.classe}">
          <i class="fas ${g.icone}"></i> <span>${g.titulo}</span>
          ${marcados ? `<span class="apr-aba-cont">${marcados}</span>` : ''}
        </button>`;
    }).join('');
    const paineis = grupos.map(g => `
      <div class="apr-grupo apr-grupo-${g.classe}" data-painel="${g.classe}" ${this._aba === g.classe ? '' : 'hidden'}>
        <p class="apr-grupo-dica">${g.dica}</p>
        ${g.lista.length ? listaDoGrupo(g) : '<p class="apr-vazio">Nada disponível para este item.</p>'}
      </div>`).join('');

    const catalogoHtml = data.comCatalogo
      ? `<div class="apr-abas-entradas">${abas}</div>${paineis}`
      : `<p class="apr-dica">Catálogo do t20-hayd-itens indisponível: descreva as melhorias e encantos manualmente.</p>
        ${this._custom.map((c, i) => `
          <div class="apr-custom" data-index="${i}">
            <select data-campo="tipo">
              <option value="melhoria" ${c.tipo === 'melhoria' ? 'selected' : ''}>Melhoria</option>
              <option value="encanto" ${c.tipo === 'encanto' ? 'selected' : ''}>Encanto</option>
            </select>
            <input type="text" data-campo="nome" placeholder="Nome" value="${escapar(c.nome)}" />
            <input type="text" data-campo="beneficio" placeholder="Benefício" value="${escapar(c.beneficio)}" />
            <button type="button" class="apr-custom-remover" title="Remover"><i class="fas fa-times"></i></button>
          </div>`).join('')}
        <button type="button" class="apr-custom-add"><i class="fas fa-plus"></i> Adicionar entrada</button>`;

    const detecTexto = detec.fontes.length
      ? `Detectado: <b>${detec.m}</b> melhoria(s) e <b>${detec.e}</b> encanto(s) (${detec.fontes.join(', ')}). Ajuste se necessário.`
      : 'Nada detectado. Informe quantos o item já tem.';

    const modoApi = data.comApi
      ? 'Entram no item pelo t20-hayd-itens e ficam listadas na descrição.'
      : 't20-hayd-itens inativo: as entradas ficam listadas na descrição e o preço é ajustado.';

    return `
      <div class="apr-cabecalho">
        <button type="button" class="apr-voltar" title="Escolher outro item"><i class="fas fa-arrow-left"></i></button>
        <img src="${alvo.img}" alt="" />
        <div class="apr-cabecalho-info">
          <strong>${escapar(alvo.nomeOriginal)}</strong>
          <small>${alvo.origem === 'loja' ? 'Item da loja' : 'Do inventário'} · valor ${precoDisplay(alvo.preco)}${calc.qtd > 1 ? ` · pilha de ${calc.qtd} munições` : ''}${alvo.separar ? ' · 1 unidade será separada da pilha' : ''}</small>
        </div>
      </div>

      <div class="apr-existentes">
        <p>${detecTexto}</p>
        <label>Melhorias já existentes <input type="number" name="existM" min="0" max="20" value="${this._existM}" /></label>
        <label>Encantos já existentes <input type="number" name="existE" min="0" max="20" value="${this._existE}" /></label>
      </div>

      <div class="apr-filtros">
        <input type="text" class="apr-busca" placeholder="Buscar melhoria, encanto ou material…" />
        ${data.comCatalogo ? `<label><input type="checkbox" name="todasCats" ${this._todasCats ? 'checked' : ''} /> Mostrar todas as categorias</label>` : ''}
      </div>

      <div class="apr-entradas">${catalogoHtml}</div>

      ${data.avisos.length ? `<ul class="apr-avisos">${data.avisos.map(a => `<li><i class="fas fa-exclamation-triangle"></i> ${escapar(a)}</li>`).join('')}</ul>` : ''}

      <div class="apr-rodape">
        <div class="apr-rodape-linha">
          <label>Forma
            <select name="modo">
              <option value="buy" ${this._modo === 'buy' ? 'selected' : ''}>Comprar</option>
              <option value="craft" ${this._modo === 'craft' ? 'selected' : ''}>Fabricar</option>
            </select>
          </label>
          <span class="apr-modo apr-modo-buy" ${this._modo === 'buy' ? '' : 'hidden'}>
            <label>Valor <input type="number" name="percent" min="1" max="200" value="${this._percent}" /> %</label>
          </span>
          <span class="apr-modo apr-modo-craft" ${this._modo === 'craft' ? '' : 'hidden'}>
            <label>Fração
              <select name="fracao">${FRACOES.map(f => `<option value="${f.value}" ${Math.abs(f.value - this._fracao) < 1e-9 ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
            </label>
            <label>Desconto matéria-prima (TP) <input type="number" name="desconto" min="0" step="0.1" value="${this._desconto}" /></label>
          </span>
        </div>
        <div class="apr-preview upgrade-preview">
          <div><span>Melhorias <i class="apr-alerta apr-alerta-m" data-tooltip-direction="UP" data-tooltip="Esse módulo considera uma fórmula personalizada para itens acima de 4 melhorias ou 3 encantos" hidden>!</i></span> <b class="apr-p-m"></b></div>
          <div><span>Encantos <i class="apr-alerta apr-alerta-e" data-tooltip-direction="UP" data-tooltip="Esse módulo considera uma fórmula personalizada para itens acima de 4 melhorias ou 3 encantos" hidden>!</i></span> <b class="apr-p-e"></b></div>
          <div><span>Materiais</span> <b class="apr-p-mat"></b></div>
          <div><span>Novo valor do item</span> <b class="apr-p-final"></b></div>
          <div><span>Custo base</span> <b class="apr-p-base"></b></div>
          <div class="apr-p-total-linha"><span>Total a pagar</span> <b class="apr-p-total"></b></div>
        </div>
        <p class="apr-dica">${modoApi}</p>
        <button type="button" class="apr-confirmar"><i class="fas fa-hammer-crash"></i> Aplicar</button>
      </div>`;
  }

  /** Atualiza só o resumo de preço, sem re-renderizar (mantém o foco). */
  _atualizarPreview(html) {
    if (this._etapa !== 'configurar') return;
    const calc = this._calcular(_catalogo);
    const tp = v => precoDisplay(v * calc.qtd);
    html.find('.apr-p-m').text(`${calc.eM} → ${calc.totalM} (+${tp(calc.deltaM)})`);
    html.find('.apr-p-e').text(`${calc.eE} → ${calc.totalE} (+${tp(calc.deltaE)})`);
    // Acima da tabela oficial (4 melhorias / 3 encantos) o preço é extrapolado
    html.find('.apr-alerta-m').prop('hidden', calc.totalM <= 4);
    html.find('.apr-alerta-e').prop('hidden', calc.totalE <= 3);
    html.find('.apr-p-mat').text(`+${tp(calc.deltaMat)}`);
    html.find('.apr-p-final').text(`${precoDisplay(calc.precoFinal)}${calc.qtd > 1 ? ' cada' : ''}`);
    html.find('.apr-p-base').text(formatarCusto(calc.baseCobre));
    const saldo = toCobre(...(w => [w.to, w.tp, w.tc])(this.shopApp._wealthInfo()));
    html.find('.apr-p-total').text(formatarCusto(calc.custoCobre))
      .toggleClass('too-expensive', calc.custoCobre > saldo);
    html.find('.apr-confirmar').prop('disabled', !calc.sel.length);
  }

  /* ── Listeners ─────────────────────────────── */

  activateListeners(html) {
    super.activateListeners(html);
    aplicarTemaLoja(this, this.actor);

    // Busca: só esconde linhas, sem re-render (preserva foco e scroll)
    html.find('.apr-busca').on('input', ev => {
      const q = ev.currentTarget.value.trim().toLowerCase();
      html.find('[data-busca]').each((_, el) => {
        el.hidden = !!q && !el.dataset.busca.includes(q);
      });
    });

    if (this._etapa === 'escolher') {
      html.find('.apr-abas button').on('click', ev => {
        this._fonte = ev.currentTarget.dataset.fonte;
        this.render();
      });
      html.find('.apr-item').on('click', ev => this._escolher(ev.currentTarget.dataset.id));
      return;
    }

    html.find('.apr-voltar').on('click', () => {
      this._etapa = 'escolher';
      this._alvo = null;
      this._resetConfig();
      this.render();
    });

    html.find('input[name="existM"], input[name="existE"]').on('change', ev => {
      const v = Math.min(20, Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0)));
      if (ev.currentTarget.name === 'existM') this._existM = v; else this._existE = v;
      this.render();
    });

    // Troca de aba sem re-render (mantém busca e scroll)
    html.find('.apr-aba').on('click', ev => {
      this._aba = ev.currentTarget.dataset.aba;
      html.find('.apr-aba').removeClass('active');
      ev.currentTarget.classList.add('active');
      html.find('[data-painel]').each((_, el) => { el.hidden = el.dataset.painel !== this._aba; });
      html.find('.apr-entradas').scrollTop(0);
    });

    html.find('.apr-entradas input[type="checkbox"][data-key]').on('change', ev => {
      const key = ev.currentTarget.dataset.key;
      if (ev.currentTarget.checked) this._sel.add(key); else this._sel.delete(key);
      this.render();
    });

    html.find('input[name="todasCats"]').on('change', ev => {
      this._todasCats = ev.currentTarget.checked;
      this.render();
    });

    html.find('.apr-custom-add').on('click', () => {
      this._custom.push({ tipo: 'melhoria', nome: '', beneficio: '' });
      this.render();
    });
    html.find('.apr-custom-remover').on('click', ev => {
      const i = Number(ev.currentTarget.closest('.apr-custom').dataset.index);
      this._custom.splice(i, 1);
      this.render();
    });
    html.find('.apr-custom [data-campo]').on('input change', ev => {
      const i = Number(ev.currentTarget.closest('.apr-custom').dataset.index);
      this._custom[i][ev.currentTarget.dataset.campo] = ev.currentTarget.value;
      this._atualizarPreview(html);
    });


    html.find('select[name="modo"]').on('change', ev => {
      this._modo = ev.currentTarget.value;
      html.find('.apr-modo-buy').prop('hidden', this._modo !== 'buy');
      html.find('.apr-modo-craft').prop('hidden', this._modo !== 'craft');
      this._atualizarPreview(html);
    });
    html.find('input[name="percent"]').on('input', ev => {
      this._percent = Math.min(200, Math.max(1, Number(ev.currentTarget.value) || 100));
      this._atualizarPreview(html);
    });
    html.find('select[name="fracao"]').on('change', ev => {
      this._fracao = Number(ev.currentTarget.value) || 1 / 3;
      this._atualizarPreview(html);
    });
    html.find('input[name="desconto"]').on('input', ev => {
      this._desconto = Math.max(0, Number(ev.currentTarget.value) || 0);
      this._atualizarPreview(html);
    });

    html.find('.apr-confirmar').on('click', ev => {
      ev.currentTarget.disabled = true;
      this._confirmar().catch(err => {
        console.error(`${MODULE_ID} | Falha ao aprimorar item`, err);
        ui.notifications.error('Falha ao aplicar os aprimoramentos. Veja o console (F12).');
      }).finally(() => { if (this.rendered) ev.currentTarget.disabled = false; });
    });

    this._atualizarPreview(html);
  }

  async _escolher(id) {
    let doc, origem;
    if (this._fonte === 'inventario') {
      doc = this.actor.items.get(id);
      origem = 'inventario';
    } else {
      doc = await fromUuid(id);
      origem = 'loja';
    }
    if (!doc) return ui.notifications.error('Item não encontrado.');

    const municao = ehMunicao(doc);
    const qtd = Number(doc.system?.qtd) || 1;
    this._resetConfig();
    this._detec = detectarExistentes(doc);
    this._existM = this._detec.m;
    this._existE = this._detec.e;
    this._alvo = {
      doc, origem, municao,
      uuid: doc.uuid,
      id: origem === 'inventario' ? doc.id : null,
      img: doc.img ?? 'icons/svg/item-bag.svg',
      nomeOriginal: doc.name,
      preco: Number(doc.system?.preco) || 0,
      // Munição: a pilha inteira é aprimorada; outros itens, uma unidade
      qtdAlvo: municao ? Math.max(1, qtd) : 1,
      separar: origem === 'inventario' && !municao && qtd > 1,
    };
    this._etapa = 'configurar';
    this.render();
  }

  /* ── Aplicação ─────────────────────────────── */

  async _confirmar() {
    const catalogo = await carregarCatalogo();
    const calc = this._calcular(catalogo);
    if (!calc.sel.length) return ui.notifications.warn('Selecione pelo menos uma melhoria, encanto ou material.');

    const wealth = this.shopApp._wealthInfo();
    if (toCobre(wealth.to, wealth.tp, wealth.tc) < calc.custoCobre) {
      return ui.notifications.warn(`${this.actor.name} não tem moedas suficientes.`);
    }

    const alvo = this._alvo;
    const item = await this._obterItemAlvo();
    if (!item) return;

    const api = apiItens();
    const viaApi = !!(api && catalogo && calc.sel.every(s => s.key) && elegivel(item, catalogo));
    if (viaApi) await this._aplicarViaItens(api, item, calc);
    else await this._aplicarNaDescricao(item, calc);

    const { to, tp, tc, troco, pago } = debitarCarteira(wealth, calc.custoCobre);
    await this.actor.update({
      'system.dinheiro.to': to,
      'system.dinheiro.tp': tp,
      'system.dinheiro.tc': tc,
    }, { t20lojaInterno: true });

    await this._mensagem(item, calc, { to, tp, tc, tl: wealth.tl }, troco, pago);

    ui.notifications.info(`${item.name}: aprimoramentos aplicados.`);
    this.shopApp.render();
    this.close();
  }

  /** Item que recebe as entradas: criado da loja, separado da pilha ou o próprio. */
  async _obterItemAlvo() {
    const alvo = this._alvo;
    if (alvo.origem === 'loja') {
      const data = alvo.doc.toObject();
      delete data._id;
      data.system.qtd = alvo.qtdAlvo;
      const [criado] = await this.actor.createEmbeddedDocuments('Item', [data]);
      return criado;
    }

    const original = this.actor.items.get(alvo.id);
    if (!original) {
      ui.notifications.error('O item não está mais no inventário.');
      return null;
    }
    if (alvo.separar && (Number(original.system?.qtd) || 1) > 1) {
      await original.update({ 'system.qtd': original.system.qtd - 1 });
      const data = original.toObject();
      delete data._id;
      data.system.qtd = 1;
      const [criado] = await this.actor.createEmbeddedDocuments('Item', [data]);
      return criado;
    }
    return original;
  }

  /**
   * Adiciona as entradas pelo t20-hayd-itens e acerta o preço base para
   * que o total dele bata com as melhorias/encantos já existentes que ele
   * não rastreia (declarados na janela).
   */
  async _aplicarViaItens(api, item, calc) {
    for (const s of calc.sel) {
      if (s.tipo === 'material') await api.efeitos.adicionarMaterial(item, s.key);
      else await api.efeitos.adicionarEntrada(item, s.key);
      item = this.actor.items.get(item.id) ?? item;
    }
    const p = api.efeitos.calcularPreco(item);
    const extras = p.melhorias + p.encantos + p.materiais;
    await api.efeitos.definirPrecoBase(item, Math.max(0, calc.precoFinal - extras));
    await this._gravarRegistro(this.actor.items.get(item.id) ?? item, calc, { descricao: true });
  }

  /** Sem o t20-hayd-itens: preço ajustado e entradas na descrição. */
  async _aplicarNaDescricao(item, calc) {
    await item.update({ 'system.preco': calc.precoFinal });
    await this._gravarRegistro(item, calc, { descricao: true });
  }

  /** Flag da loja (para detectar depois) e, opcionalmente, bloco na descrição. */
  async _gravarRegistro(item, calc, { descricao }) {
    const anterior = item.getFlag(MODULE_ID, 'aprimoramentos') ?? {};
    const entradas = [
      ...(anterior.entradas ?? []),
      ...calc.sel.map(s => ({ nome: s.nome, tipo: s.tipo, beneficio: s.beneficio, especial: s.especial })),
    ];
    const update = {
      [`flags.${MODULE_ID}.aprimoramentos`]: { nMelhorias: calc.totalM, nEncantos: calc.totalE, entradas },
    };
    if (descricao) {
      const atual = item.system?.description?.value ?? '';
      const bloco = blocoDescricao(entradas);
      update['system.description.value'] = RE_BLOCO.test(atual) ? atual.replace(RE_BLOCO, bloco) : `${bloco}${atual}`;
    }
    await item.update(update);
  }

  async _mensagem(item, calc, saldo, troco, pago) {
    if (!game.settings.get(MODULE_ID, 'enableChatMessages')) return;
    const rotulo = { melhoria: 'Melhoria', encanto: 'Encanto', material: 'Material' };
    const lista = `<ul class="t20l-aprim">${calc.sel.map(s =>
      `<li class="t20l-aprim-${s.tipo}"><span>${escapar(s.nome)}</span><small>${rotulo[s.tipo] ?? s.tipo}</small></li>`).join('')}</ul>`;
    const forma = this._modo === 'buy'
      ? linhaCartao('Compra', `<b>${this._percent}%</b>`)
      : linhaCartao('Fabricação', `<b>${FRACOES.find(f => Math.abs(f.value - this._fracao) < 1e-9)?.label ?? ''}</b> · ${this._desconto > 0
        ? `desconto ${formatarCusto(Math.round(this._desconto * 10))}`
        : '<small class="t20l-nulo">sem desconto</small>'}`);

    const content = cartaoLoja({
      icone: 'fa-hammer-crash',
      titulo: this._alvo.origem === 'loja' ? 'adquiriu um item superior' : 'aprimorou um item',
      ator: this.actor.name,
      corpo: `
        <div class="t20l-item"><img src="${item.img}" alt="" />${escapar(item.name)}${calc.qtd > 1 ? ` <em>×${calc.qtd}</em>` : ''}</div>
        <div class="t20l-aprim-titulo">Adicionado</div>
        ${lista}
        ${linhaCartao('Total', `<b>${calc.totalM}</b> melhoria(s) · <b>${calc.totalE}</b> encanto(s)`)}
        ${linhaCartao('Novo valor', `<b>${precoDisplay(calc.precoFinal)}</b>`)}
        ${forma}
        ${linhaCartao('Total pago', `<b>${formatarCusto(calc.custoCobre)}</b>`)}
        ${linhaPagamento(pago)}
        ${troco ? linhaCartao('Troco', moedasChips(troco)) : ''}`,
      saldo,
      mostrarTl: atorUsaPlatina(this.actor),
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      whisper: getChatRecipients(),
    });
  }
}
