# T20 Hayd Loja

Loja integrada para o sistema **Tormenta20** no **FoundryVTT v13**. Adiciona um botão na ficha do personagem que abre uma loja com itens de compêndios, do mundo e individuais, descontando automaticamente as moedas na compra.

## O que faz

- Botão **"Loja"** no cabeçalho da ficha de personagem.
- Vitrine com todos os itens das fontes configuradas, com busca e filtros.
- **Compra automática**: desconta o preço das moedas do personagem (TC/T$/TO) e adiciona o item ao inventário; bloqueia a compra se não houver saldo.
- **Mensagens de chat** opcionais a cada compra (com opção de sussurro só para o Mestre).
- **Monitor de dinheiro** opcional: posta no chat quando o dinheiro de um personagem muda.
- Compatível com o tema do **t20-hayd-ui** (herda a cor de destaque quando ativo).

## Como usar

1. Ative o módulo no mundo.
2. Abra uma ficha de personagem e clique em **Loja** no topo da janela.
3. Escolha um item e clique em **Comprar** — as moedas são descontadas automaticamente.

## Fontes da loja (Mestre)

Em *Configurar → Configurações → T20 Hayd Loja → **Configurar Fontes da Loja***:

| Fonte | Descrição |
|---|---|
| Incluir Compêndios do Sistema | Adiciona automaticamente os compêndios de itens do Tormenta20. |
| Incluir Itens do Mundo | Adiciona os itens cadastrados na aba *Itens* da barra lateral. |
| Compêndios Adicionais | Outros compêndios de itens a exibir na loja. |
| Itens Individuais por UUID | UUIDs de itens específicos a incluir. |

Outras configurações: ligar/desligar mensagens de compra no chat, sussurrá-las ao Mestre e monitorar mudanças de dinheiro (por jogador ou de todos).

## Requisitos

- FoundryVTT **v13** (compatível a partir da v11)
- Sistema **Tormenta20**
- *(Opcional)* **t20-hayd-ui** para o tema visual combinado

## Instalação

Em *Configurar → Módulos Complementares → Instalar Módulo*, cole a URL do manifesto:

```
https://raw.githubusercontent.com/ahahayd/t20-hayd-loja/main/module.json
```

## Aviso

Módulo não oficial, sem afiliação com a Jambô Editora ou com os autores de Tormenta20.
