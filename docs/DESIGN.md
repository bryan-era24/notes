# Design standard

Purpose: say what every colour and control style in Notas means, so the screen can be read at a glance by an older seller and a new
screen never picks a colour "because it looks nice". Modelled on the Relieve standard: tokens only, no inline colours, one meaning per
colour, the main action in ink, blue only for "what you chose", green only for "done", red only for "this deletes or failed".

Enforced by `tests/design.test.js` (TC-NFR-07-01 to TC-NFR-07-06). Decision: `docs/decisions/0013-colours-carry-meaning.md`.

## 1. Rules

1. A colour appears only as a token in `:root` of `css/styles.css`. No hex, `rgb()` or `hsl()` anywhere else, and no inline colour in
   `js/app.js` markup.
2. Every token has exactly one meaning, listed in the table below. A new token needs a row here and in the test's list.
3. Colour never carries meaning alone: a pill or banner always has words, and cancelled also strikes the text.
4. Text on its background passes 4.5:1 (WCAG AA). The test computes the ratio for every pair in §4.
5. At most two main actions per block (`.primary`), such as "Agregar nota" and "Registrar pago". Everything else is secondary or
   quiet.
6. Touch targets stay at least 56 px (`--tap`); type stays Atkinson Hyperlegible, 19 px body.

## 2. Tokens

| Token                | Value     | Means                                  | Used for                                                              |
| -------------------- | --------- | -------------------------------------- | --------------------------------------------------------------------- |
| `--desk`             | `#eef3f7` | the table under the pad                | page background                                                       |
| `--sheet`            | `#ffffff` | paper                                  | cards, lists, inputs, secondary buttons                               |
| `--ink`              | `#1a2433` | writing and the main action            | text, `.primary` buttons, top bar, dock, toast                        |
| `--ink-soft`         | `#4a5a70` | secondary writing                      | hints, dates, labels, fold arrows, report bars                        |
| `--rule`             | `#c9d6e2` | the pad's printed lines                | separators                                                            |
| `--rule-strong`      | `#93a8bd` | edges you can touch                    | input borders, quiet buttons, section lines                           |
| `--select`           | `#1f4fbf` | what you chose or where you are        | links, focus ring, current tab, pressed chips, open tile, filter band |
| `--select-soft`      | `#e3eafa` | background of a choice                 | pressed chips, open tile, presentations, filter band                  |
| `--folio`            | `#b3261e` | the printed folio number               | folio and device code only, never a state                             |
| `--progress`         | `#5b3fa6` | work under way                         | stage "En preparación"                                                |
| `--progress-soft`    | `#eee9f9` | background of work under way           | stage "En preparación"                                                |
| `--done`             | `#1e6b3a` | finished, nothing left to do           | stages "Entregado" and "Recibido y firmado", "Pagado", balance $0     |
| `--done-soft`        | `#e2f2e6` | background of finished                 | stage "Entregado", "Pagado", success notice                           |
| `--attention`        | `#7a4a00` | needs you: money owed or a reminder    | "Pendiente", "Pago parcial", balance owed, warnings                   |
| `--attention-soft`   | `#fbefd9` | background of attention                | "Pago parcial", warning notices                                       |
| `--info`             | `#0f5c69` | for your information, no action needed | "Saldo a favor", information notices                                  |
| `--info-soft`        | `#e0f1f3` | background of information              | "Saldo a favor", information notices                                  |
| `--danger`           | `#9f1d1d` | deletes, discards or failed            | delete and discard buttons, error notices, confirmations              |
| `--danger-soft`      | `#fdeceb` | background of danger                   | error notices and delete confirmations                                |
| `--muted`            | `#59626e` | no longer counts                       | stage "Cancelado", inactive products                                  |
| `--muted-soft`       | `#eceff2` | background of no longer counts         | stage "Cancelado"                                                     |
| `--on-ink`           | `#ffffff` | writing on ink                         | text on the top bar, dock, toast, `.primary`                          |
| `--on-ink-soft`      | `#cfdbe8` | quiet writing on ink                   | sync line when all is well                                            |
| `--on-ink-attention` | `#ffd79a` | attention on ink                       | sync line when something waits                                        |
| `--on-ink-danger`    | `#ffb4ab` | failure on ink                         | sync line when saving or syncing failed                               |

## 3. States

Stages are informative and never block anything; their colours go from neutral to green as the order advances.

| Stage                                  | Pill and pressed chip                                  |
| -------------------------------------- | ------------------------------------------------------ |
| Pedido (`ordered`)                     | paper with an ink-soft edge: written down, not started |
| En preparación (`preparing`)           | `--progress` on `--progress-soft`                      |
| Entregado (`delivered`)                | `--done` on `--done-soft`, dashed edge                 |
| Recibido y firmado (`received_signed`) | `--on-ink` on `--done`: the strongest "finished"       |
| Cancelado (`cancelled`)                | `--muted` on `--muted-soft`, struck through            |

| Payment status           | Pill                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| Pendiente (`pending`)    | `--on-ink` on `--attention`: nothing paid yet, the strongest attention |
| Pago parcial (`partial`) | `--attention` on `--attention-soft`                                    |
| Pagado (`paid`)          | `--done` on `--done-soft`                                              |
| Saldo a favor (`credit`) | `--info` on `--info-soft`                                              |

Notices always carry a tone: `notice warn` (something needs you), `notice info` (something is happening or worth knowing),
`notice error` (something failed), `notice danger` (you are about to delete or discard), `notice ok` (it worked).

The sync line on the top bar uses `data-tone`: empty (all well), `warn` (something waits), `error` (saving or syncing failed).

## 4. Controls

| Class                              | Looks                       | Use for                                                             |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| `button` (no class)                | paper, ink edge, ink text   | secondary actions                                                   |
| `.primary`                         | ink fill, white text        | the one main action of a block: Guardar, Nueva nota, Registrar pago |
| `.quiet`                           | paper, soft edge, ink text  | Cancelar, Limpiar, paging, expand and collapse                      |
| `.danger`                          | paper, danger edge and text | the first tap of a delete or discard                                |
| `.danger.primary`                  | danger fill, white text     | the second, confirming tap                                          |
| `.chips button[aria-pressed=true]` | select edge on select-soft  | the chosen option; stage chips use the stage colours of §3          |

Contrast pairs checked by the test: ink, ink-soft on sheet and desk; on-ink on ink, done, attention, danger; on-ink-soft,
on-ink-attention, on-ink-danger on ink; every `-soft` pair of §2 with its strong colour; select on sheet and select-soft; folio on sheet;
muted on muted-soft.
