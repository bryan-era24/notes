/*
 * Purpose: The printer adapter layer: the screens hand over a print model and the chosen adapter prints it.
 * Responsibilities: Print letter pages and tickets through the browser's print dialog (works on every device), and send ESC/POS bytes
 * (js/escpos.js) to a thermal printer over Web Bluetooth, Web Serial or Web USB where the browser offers them. Adding a printer means
 * adding one transport here. It also offers sharing as text. It touches only #print-root, #page-size, the page title (set to the
 * note's file name while printing, so "Save as PDF" proposes it) and browser device APIs.
 */
window.NT = window.NT || {};

NT.printers = (function () {
  "use strict";

  var CHUNK = 180; // bytes per Bluetooth write: safe for most BLE printers

  function nav() {
    return typeof navigator !== "undefined" ? navigator : {};
  }

  // ---------- browser print (default) ----------
  var currentPrint = 0;
  var pageTitle = null; // the app's own title while a print has changed it
  function browserPrint(kind, html, width, title) {
    var mine = ++currentPrint;
    var root = document.getElementById("print-root");
    var page = document.getElementById("page-size");
    var finished = false;
    if (pageTitle === null) pageTitle = document.title;
    // Browsers name a "Save as PDF" file after the page title: use the note's file name while printing.
    if (title) document.title = title;
    root.innerHTML = html;
    page.textContent =
      kind === "letter"
        ? "@page { size: letter; margin: 12mm 14mm; }"
        : "@page { size: " + (width === 58 ? "58mm" : "80mm") + " auto; margin: 0; }";
    document.body.setAttribute("data-printing", kind);
    var done = function () {
      if (finished) return;
      finished = true;
      window.removeEventListener("afterprint", done);
      // A later print owns the page now: leave it alone.
      if (mine !== currentPrint) return;
      document.body.removeAttribute("data-printing");
      root.innerHTML = "";
      document.title = pageTitle;
      pageTitle = null;
    };
    window.addEventListener("afterprint", done);
    try {
      window.print();
    } finally {
      // Some mobile browsers never fire afterprint; clean up later either way.
      setTimeout(done, 60000);
    }
    return Promise.resolve();
  }

  // ---------- ESC/POS transports (ready for when a printer is chosen) ----------
  var bt = { device: null, characteristic: null };
  // Services used by common Bluetooth thermal printers (generic serial-over-BLE profiles).
  var BT_SERVICES = [
    "000018f0-0000-1000-8000-00805f9b34fb",
    "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    "0000ff00-0000-1000-8000-00805f9b34fb",
  ];

  /** Writes bytes in chunks to a characteristic. Exposed for tests. */
  function writeChunks(characteristic, bytes) {
    var chain = Promise.resolve();
    for (var i = 0; i < bytes.length; i += CHUNK) {
      (function (part) {
        chain = chain.then(function () {
          return characteristic.writeValueWithoutResponse && characteristic.properties && characteristic.properties.writeWithoutResponse
            ? characteristic.writeValueWithoutResponse(part)
            : characteristic.writeValue(part);
        });
      })(bytes.slice(i, i + CHUNK));
    }
    return chain;
  }

  function bluetoothCharacteristic() {
    if (bt.characteristic && bt.device && bt.device.gatt && bt.device.gatt.connected) return Promise.resolve(bt.characteristic);
    var start = bt.device
      ? Promise.resolve(bt.device)
      : nav().bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
    return start
      .then(function (device) {
        bt.device = device;
        return device.gatt.connect();
      })
      .then(function (server) {
        return server.getPrimaryServices();
      })
      .then(function (services) {
        return Promise.all(
          services.map(function (s) {
            return s.getCharacteristics().catch(function () {
              // catch-ok: a service we may not read is simply skipped.
              return [];
            });
          })
        );
      })
      .then(function (lists) {
        var all = [].concat.apply([], lists);
        var ch = all.find(function (c) {
          return c.properties && (c.properties.write || c.properties.writeWithoutResponse);
        });
        if (!ch) throw new Error("no_writable_characteristic");
        bt.characteristic = ch;
        return ch;
      });
  }

  var transports = {
    "escpos-bluetooth": {
      available: function () {
        return !!nav().bluetooth;
      },
      send: function (bytes) {
        return bluetoothCharacteristic().then(function (ch) {
          return writeChunks(ch, bytes);
        });
      },
    },
    "escpos-serial": {
      available: function () {
        return !!nav().serial;
      },
      send: function (bytes) {
        var port;
        return nav()
          .serial.requestPort()
          .then(function (p) {
            port = p;
            return port.open({ baudRate: 9600 });
          })
          .then(function () {
            var writer = port.writable.getWriter();
            return writer.write(bytes).then(function () {
              writer.releaseLock();
              return port.close();
            });
          });
      },
    },
    "escpos-usb": {
      available: function () {
        return !!nav().usb;
      },
      send: function (bytes) {
        var device, endpoint;
        return nav()
          .usb.requestDevice({ filters: [] })
          .then(function (d) {
            device = d;
            return device.open();
          })
          .then(function () {
            return device.configuration ? null : device.selectConfiguration(1);
          })
          .then(function () {
            var iface = null;
            device.configuration.interfaces.forEach(function (i) {
              (i.alternate.endpoints || []).forEach(function (e) {
                if (!iface && e.direction === "out" && e.type === "bulk") {
                  iface = i;
                  endpoint = e;
                }
              });
            });
            if (!iface) throw new Error("no_usb_output");
            return device.claimInterface(iface.interfaceNumber);
          })
          .then(function () {
            return device.transferOut(endpoint.endpointNumber, bytes);
          })
          .then(function () {
            return device.close();
          });
      },
    },
  };

  /** Printer choices for Ajustes: [{ id, available }]. */
  function choices() {
    return [{ id: "browser", available: true }].concat(
      Object.keys(transports).map(function (id) {
        return { id: id, available: transports[id].available() };
      })
    );
  }

  /** Letter page: always through the browser (it is also how a PDF is saved). */
  function printLetter(model, t, opts) {
    return browserPrint("letter", NT.print.letterHtml(model, t, opts), null, opts && opts.title);
  }

  /** Ticket: through the chosen adapter. opts: { printer, width, formatDate } */
  function printTicket(model, t, opts) {
    var printer = opts.printer || "browser";
    var transport = transports[printer];
    if (!transport || !transport.available()) return browserPrint("ticket", NT.print.ticketHtml(model, t, opts), opts.width, opts.title);
    var bytes = NT.escpos.encode(model, t, { cols: opts.width === 58 ? 32 : 48, formatDate: opts.formatDate });
    return transport.send(bytes);
  }

  /** Shares text with the system share sheet. Resolves "shared", "cancelled" or "unavailable" (the app then offers WhatsApp and copy). */
  function shareText(text, title) {
    var n = nav();
    if (!n.share) return Promise.resolve("unavailable");
    return n.share({ title: title, text: text }).then(
      function () {
        return "shared";
      },
      function (e) {
        // catch-ok: closing the share sheet is not an error; anything else falls back to WhatsApp and copy.
        return e && e.name === "AbortError" ? "cancelled" : "unavailable";
      }
    );
  }

  function copyText(text) {
    var n = nav();
    if (n.clipboard && n.clipboard.writeText) return n.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } finally {
      area.remove();
    }
    return Promise.resolve();
  }

  function whatsappUrl(text) {
    return "https://wa.me/?text=" + encodeURIComponent(text);
  }

  return {
    choices: choices,
    printLetter: printLetter,
    printTicket: printTicket,
    shareText: shareText,
    copyText: copyText,
    whatsappUrl: whatsappUrl,
    writeChunks: writeChunks,
    CHUNK: CHUNK,
  };
})();
