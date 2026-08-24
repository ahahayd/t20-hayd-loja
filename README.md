# T20 Hayd Loja

Loja integrada para o sistema **Tormenta20** no FoundryVTT: um botão na ficha do personagem abre a vitrine com itens de compêndios, do mundo e individuais, com compra e venda descontando as moedas automaticamente.

## Requisitos

- FoundryVTT **v13**
- Sistema **Tormenta20**
- *(Opcional)* **t20-hayd-ui** — a loja herda o tema e a cor de destaque quando ativo

## Instalação

Em *Configurar → Módulos Complementares → Instalar Módulo*, cole a URL do manifesto:

```
https://github.com/ahahayd/t20-hayd-loja/releases/latest/download/module.json
```

## Como usar

### Comprar

Abra a ficha do personagem e clique em **Loja** no topo da janela. Busque ou filtre o item desejado e clique em **Comprar** — o preço é descontado das moedas (TC, T$, TO) e o item entra no inventário. Uma barra de percentual permite ajustar o valor da compra de 10% a 200% do preço, para pechinchas e mercadores gananciosos. Sem saldo suficiente, a compra é bloqueada.

Também é possível comprar magias, como pergaminho (versão padrão) ou poção (com aprimoramentos escolhidos na hora).

### Vender

Na aba de venda, escolha itens do próprio inventário e o percentual do preço a receber. Itens de poder e habilidades não aparecem na lista — só o que faz sentido vender.

### Troco realista (opcional)

Com a opção ligada, o troco sai como um mercador de verdade daria: compras pequenas rendem troco em moedas menores e valores altos são consolidados em TO a partir de um limiar configurável. O pagamento usa o menor número possível de moedas e o chat mostra exatamente **como foi pago** e o troco recebido.

### Monitor de dinheiro (Mestre)

Opcionalmente, mudanças de dinheiro nas fichas são anunciadas no chat em cards com o delta de cada moeda; alterações em sequência são agrupadas em uma única mensagem. As próprias transações da loja não geram aviso duplicado.

### Fontes da loja (Mestre)

Em *Configurar → Configurações → T20 Hayd Loja → Configurar Fontes da Loja*: incluir os compêndios do sistema, os itens do mundo, compêndios adicionais e itens individuais por UUID.

## Detalhes adicionais

- Mensagens de compra no chat são opcionais e podem ser sussurradas apenas ao Mestre.
- O campo de platina (TL) só aparece quando a regra de platina está habilitada no mundo.

## Aviso

Módulo não oficial, criado por fã, sem afiliação com a Jambô Editora ou com os autores de Tormenta20.
