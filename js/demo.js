/*
 * Purpose: Demonstration data to try the app (and, in Connected mode, to populate the database), and a way to remove it.
 * Responsibilities: Create a made-up business name (only when none is set), catalog, customers, orders around today, notes, stages and partial payments through NT.repo, marking every
 * document with demo: true, and soft-delete exactly those documents on request. Names and phones are invented; never put real data here.
 */
window.NT = window.NT || {};

NT.demo = (function () {
  "use strict";

  var PRODUCTS = [
    {
      key: "man",
      name: "Palomitas de mantequilla",
      presentations: [
        ["250 g", 250, 3500],
        ["500 g", 500, 6500],
        ["1 kg", 1000, 12000],
      ],
    },
    {
      key: "car",
      name: "Palomitas de caramelo",
      presentations: [
        ["245 g", 245, 3800],
        ["1 kg", 1000, 13000],
      ],
    },
    { key: "chi", name: "Palomitas enchiladas", presentations: [["200 g", 200, 3200]] },
    { key: "mix", name: "Bolsa fiesta surtida", presentations: [["Bolsa", null, 6000]] },
    {
      key: "cha",
      name: "Charola para evento",
      presentations: [
        ["Charola chica", null, 25000],
        ["Charola grande", null, 42000],
      ],
    },
  ];
  var CUSTOMERS = ["Escuela Primaria Ejemplo", "Doña Carmen (ejemplo)", "Tienda La Esquina (ejemplo)", "Fiestas Ejemplo", "Café de Prueba"];
  // [day offset, customer index or -1, stage, [[product, presentation index, qty], ...] per note, paid fraction]
  var ORDERS = [
    [
      -6,
      0,
      "received_signed",
      [
        [
          ["man", 0, 25],
          ["car", 0, 25],
        ],
      ],
      1,
    ],
    [
      -4,
      1,
      "delivered",
      [
        [
          ["man", 2, 2],
          ["chi", 0, 10],
        ],
      ],
      0.5,
    ],
    [-2, 2, "delivered", [[["mix", 0, 30]], [["man", 0, 12]]], 0],
    [-1, -1, "delivered", [[["car", 1, 1]]], 1],
    [
      0,
      3,
      "preparing",
      [
        [
          ["cha", 1, 2],
          ["mix", 0, 20],
        ],
      ],
      0.3,
    ],
    [
      0,
      4,
      "ordered",
      [
        [
          ["man", 1, 6],
          ["car", 0, 6],
        ],
      ],
      0,
    ],
    [
      1,
      0,
      "ordered",
      [
        [
          ["man", 0, 40],
          ["car", 0, 40],
        ],
        [["chi", 0, 15]],
      ],
      0.25,
    ],
    [2, 2, "ordered", [[["mix", 0, 50]]], 0],
    [
      4,
      1,
      "ordered",
      [
        [
          ["man", 2, 3],
          ["car", 1, 2],
        ],
      ],
      0,
    ],
    [6, 3, "ordered", [[["cha", 0, 4]]], 0],
  ];

  /** Writes the demonstration data. env.today() decides the dates. Resolves with the number of orders created. */
  function load(repo, store, today) {
    var productIds = {},
      customerIds = [];
    var chain = Promise.resolve();
    if (!repo.settings().name) {
      chain = chain.then(function () {
        return repo.saveSettings({ name: "Palomitas de Ejemplo", phone: "33 0000 0000", ticketFooter: "¡Gracias por su compra!" });
      });
    }
    PRODUCTS.forEach(function (p, i) {
      chain = chain.then(function () {
        return repo
          .saveProduct(null, {
            demo: true,
            name: p.name,
            position: i,
            presentations: p.presentations.map(function (x) {
              return { label: x[0], grams: x[1], price: x[2] };
            }),
          })
          .then(function (id) {
            productIds[p.key] = id;
          });
      });
    });
    CUSTOMERS.forEach(function (name, i) {
      chain = chain.then(function () {
        return repo.saveCustomer(null, { demo: true, name: name, phone: "33 0000 000" + i }).then(function (id) {
          customerIds.push(id);
        });
      });
    });
    ORDERS.forEach(function (o) {
      chain = chain.then(function () {
        var cid = o[1] >= 0 ? customerIds[o[1]] : null;
        var cname = o[1] >= 0 ? CUSTOMERS[o[1]] : "";
        var orderId;
        return repo
          .createOrder({ demo: true, customerId: cid, customerName: cname, deliveryDate: NT.logic.addDays(today, o[0]), stage: o[2] })
          .then(function (id) {
            orderId = id;
            var notes = Promise.resolve();
            o[3].forEach(function (lines) {
              notes = notes.then(function () {
                return repo.saveNote(null, {
                  demo: true,
                  orderId: orderId,
                  stage: o[2],
                  lines: lines.map(function (l) {
                    var pid = productIds[l[0]];
                    var product = store.get("products/" + pid);
                    return NT.logic.lineFrom(pid, product, product.presentations[l[1]], l[2]);
                  }),
                });
              });
            });
            return notes;
          })
          .then(function () {
            if (!o[4]) return;
            var total = NT.logic.orderTotal(repo.notesOf(orderId));
            var amount = Math.round((total * o[4]) / 100) * 100;
            if (amount > 0)
              return repo.addPayment({ demo: true, orderId: orderId, amount: amount, method: o[4] === 1 ? "cash" : "transfer" });
          });
      });
    });
    return chain.then(function () {
      return ORDERS.length;
    });
  }

  /** Paths of the demonstration documents that are still live. */
  function paths(store) {
    var out = [];
    ["products", "customers", "orders", "notes", "payments"].forEach(function (c) {
      store.list(c).forEach(function (d) {
        if (d.data.demo && !d.data.deletedAt) out.push(d.path);
      });
    });
    return out;
  }

  /** Soft-deletes every demonstration document. Resolves with how many were removed. */
  function remove(repo, store) {
    var list = paths(store);
    var chain = Promise.resolve();
    list.forEach(function (p) {
      chain = chain.then(function () {
        return repo.remove(p);
      });
    });
    return chain.then(function () {
      return list.length;
    });
  }

  return { load: load, remove: remove, paths: paths };
})();
