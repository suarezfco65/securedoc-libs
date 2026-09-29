/* Tabla de Datos — Web Component <data-table>
 * Librería visual reutilizable en JavaScript puro (sin framework, sin build).
 * No lee ni escribe datos por su cuenta: solo muestra lo que le pasas y avisa
 * de las interacciones mediante eventos. Hereda los estilos Bootstrap 5 de la
 * página que la carga (no usa Shadow DOM).
 */
(function (global) {
  "use strict";

  // Guard: si ya se definió el componente, no volver a registrarlo.
  if (global.customElements && global.customElements.get("data-table")) {
    return;
  }

  // ---- Utilidades internas (privadas, sin variables sueltas en global) ----

  function toBool(value) {
    // Un atributo booleano existe (aunque sea "") => activo; "false" => inactivo.
    if (value === null || value === undefined) return false;
    return String(value).toLowerCase() !== "false";
  }

  function isPlainArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  function safeText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return String(value);
      }
    }
    return String(value);
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function compareValues(a, b) {
    // Comparación estable: números como números, resto como texto.
    var na = parseFloat(a);
    var nb = parseFloat(b);
    var aNum = !isNaN(na) && String(a).trim() !== "" && isFinite(na);
    var bNum = !isNaN(nb) && String(b).trim() !== "" && isFinite(nb);
    if (aNum && bNum) {
      return na - nb;
    }
    var sa = safeText(a).toLowerCase();
    var sb = safeText(b).toLowerCase();
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  }

  // CSV -> array de objetos (parser propio, sin eval).
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var c;
    var len = text.length;

    function pushField() {
      row.push(field);
      field = "";
    }
    function pushRow() {
      pushField();
      rows.push(row);
      row = [];
    }

    while (i < len) {
      c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        pushField();
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        pushRow();
        i++;
        continue;
      }
      field += c;
      i++;
    }
    // Último campo/fila si el texto no termina en salto de línea.
    if (field !== "" || row.length > 0) {
      pushRow();
    }

    // Quitar filas totalmente vacías.
    rows = rows.filter(function (r) {
      return !(r.length === 1 && r[0] === "");
    });
    if (rows.length === 0) return [];

    var headers = rows.shift();
    return rows.map(function (r) {
      var obj = {};
      for (var k = 0; k < headers.length; k++) {
        obj[headers[k]] = r[k] !== undefined ? r[k] : "";
      }
      return obj;
    });
  }

  // array de objetos -> CSV (escapando comillas y separadores).
  function toCSV(data, columns) {
    var keys = columns.map(function (col) {
      return col.key;
    });
    function escape(v) {
      var s = safeText(v);
      if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
    var lines = [];
    lines.push(
      columns
        .map(function (col) {
          return escape(col.label);
        })
        .join(",")
    );
    data.forEach(function (rowObj) {
      lines.push(
        keys
          .map(function (key) {
            return escape(rowObj[key]);
          })
          .join(",")
      );
    });
    return lines.join("\r\n");
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Liberar el objeto URL un poco después de disparar la descarga.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // ---- Definición del Web Component ----

  var DataTable = (function () {
    function DataTableClass() {
      var self = Reflect.construct(HTMLElement, [], DataTableClass);
      // Estado interno (privado a la instancia).
      self._data = [];
      self._columns = [];
      self._filterText = "";
      self._sortKey = null;
      self._sortDir = 1; // 1 asc, -1 desc
      self._page = 1;
      self._built = false;
      self._els = {};
      return self;
    }

    DataTableClass.prototype = Object.create(HTMLElement.prototype);
    DataTableClass.prototype.constructor = DataTableClass;

    Object.defineProperty(DataTableClass, "observedAttributes", {
      get: function () {
        return [
          "sortable",
          "filterable",
          "paginate",
          "page-size",
          "exportable",
          "importable"
        ];
      }
    });

    // ---- Propiedades JS ----

    Object.defineProperty(DataTableClass.prototype, "data", {
      get: function () {
        return this._data.slice();
      },
      set: function (value) {
        this._data = isPlainArray(value) ? value.slice() : [];
        this._page = 1;
        this._render();
      }
    });

    Object.defineProperty(DataTableClass.prototype, "columns", {
      get: function () {
        return this._columns.slice();
      },
      set: function (value) {
        this._columns = isPlainArray(value)
          ? value.map(function (c) {
              if (typeof c === "string") return { key: c, label: c };
              return { key: c.key, label: c.label !== undefined ? c.label : c.key };
            })
          : [];
        this._render();
      }
    });

    // ---- Config leída desde atributos ----

    DataTableClass.prototype._cfg = function () {
      return {
        sortable: toBool(this.getAttribute("sortable")),
        filterable: toBool(this.getAttribute("filterable")),
        paginate: toBool(this.getAttribute("paginate")),
        pageSize: Math.max(1, parseInt(this.getAttribute("page-size"), 10) || 10),
        exportable: toBool(this.getAttribute("exportable")),
        importable: toBool(this.getAttribute("importable"))
      };
    };

    // ---- Ciclo de vida ----

    DataTableClass.prototype.connectedCallback = function () {
      if (!this._built) {
        this._build();
        this._built = true;
      }
      // Si no se pasaron columnas y hay datos, deducirlas de las claves.
      if (this._columns.length === 0 && this._data.length > 0) {
        this._columns = Object.keys(this._data[0]).map(function (k) {
          return { key: k, label: k };
        });
      }
      this._render();
    };

    DataTableClass.prototype.attributeChangedCallback = function () {
      if (this._built) this._render();
    };

    // ---- Construcción del esqueleto (una sola vez) ----

    DataTableClass.prototype._build = function () {
      var self = this;

      var toolbar = el("div", "d-flex flex-wrap gap-2 align-items-center mb-2");

      // Buscador (filtro).
      var searchWrap = el("div", "flex-grow-1");
      var search = el("input", "form-control form-control-sm");
      search.type = "search";
      search.placeholder = "Buscar…";
      search.setAttribute("aria-label", "Buscar en la tabla");
      search.addEventListener("input", function () {
        self._filterText = search.value || "";
        self._page = 1;
        self._render();
        self._emit("filter", { filter: self._filterText });
      });
      searchWrap.appendChild(search);

      // Botones importar / exportar.
      var actions = el("div", "d-flex gap-2");

      var importBtn = el("button", "btn btn-sm btn-outline-secondary");
      importBtn.type = "button";
      importBtn.textContent = "Importar";
      var fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = ".csv,.json,application/json,text/csv";
      fileInput.style.display = "none";
      importBtn.addEventListener("click", function () {
        fileInput.value = "";
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.addEventListener("load", function () {
          self._handleImport(String(reader.result || ""), file.name);
        });
        reader.addEventListener("error", function () {
          self._emit("error", { message: "No se pudo leer el archivo." });
        });
        reader.readAsText(file);
      });

      var exportCsvBtn = el("button", "btn btn-sm btn-outline-secondary");
      exportCsvBtn.type = "button";
      exportCsvBtn.textContent = "Exportar CSV";
      exportCsvBtn.addEventListener("click", function () {
        self._exportCSV();
      });

      var exportJsonBtn = el("button", "btn btn-sm btn-outline-secondary");
      exportJsonBtn.type = "button";
      exportJsonBtn.textContent = "Exportar JSON";
      exportJsonBtn.addEventListener("click", function () {
        self._exportJSON();
      });

      actions.appendChild(importBtn);
      actions.appendChild(exportCsvBtn);
      actions.appendChild(exportJsonBtn);

      toolbar.appendChild(searchWrap);
      toolbar.appendChild(actions);

      // Contenedor de la tabla.
      var tableWrap = el("div", "table-responsive");
      var table = el("table", "table table-sm table-striped table-hover align-middle mb-0");
      var thead = el("thead");
      var tbody = el("tbody");
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      // Pie: info + paginación.
      var footer = el("div", "d-flex flex-wrap justify-content-between align-items-center mt-2 gap-2");
      var info = el("small", "text-muted");
      var pager = el("nav");
      var pagerList = el("ul", "pagination pagination-sm mb-0");
      pager.appendChild(pagerList);
      footer.appendChild(info);
      footer.appendChild(pager);

      this.appendChild(toolbar);
      this.appendChild(fileInput);
      this.appendChild(tableWrap);
      this.appendChild(footer);

      this._els = {
        toolbar: toolbar,
        searchWrap: searchWrap,
        search: search,
        actions: actions,
        importBtn: importBtn,
        exportCsvBtn: exportCsvBtn,
        exportJsonBtn: exportJsonBtn,
        thead: thead,
        tbody: tbody,
        info: info,
        pager: pager,
        pagerList: pagerList
      };
    };

    // ---- Datos procesados (filtro + orden) ----

    DataTableClass.prototype._processed = function () {
      var self = this;
      var rows = this._data.slice();

      // Filtro (busca en todas las columnas visibles como texto).
      var q = this._filterText.trim().toLowerCase();
      if (q) {
        rows = rows.filter(function (row) {
          for (var i = 0; i < self._columns.length; i++) {
            var v = safeText(row[self._columns[i].key]).toLowerCase();
            if (v.indexOf(q) !== -1) return true;
          }
          return false;
        });
      }

      // Orden.
      if (this._sortKey !== null) {
        var key = this._sortKey;
        var dir = this._sortDir;
        rows.sort(function (a, b) {
          return compareValues(a[key], b[key]) * dir;
        });
      }
      return rows;
    };

    // ---- Render completo ----

    DataTableClass.prototype._render = function () {
      if (!this._built) return;
      var self = this;
      var cfg = this._cfg();
      var els = this._els;

      // Mostrar/ocultar controles según configuración.
      els.searchWrap.style.display = cfg.filterable ? "" : "none";
      els.importBtn.style.display = cfg.importable ? "" : "none";
      els.exportCsvBtn.style.display = cfg.exportable ? "" : "none";
      els.exportJsonBtn.style.display = cfg.exportable ? "" : "none";
      els.actions.style.display =
        cfg.importable || cfg.exportable ? "" : "none";
      els.toolbar.style.display =
        cfg.filterable || cfg.importable || cfg.exportable ? "" : "none";

      var rows = this._processed();
      var total = rows.length;

      // Paginación.
      var pageRows = rows;
      var totalPages = 1;
      if (cfg.paginate) {
        totalPages = Math.max(1, Math.ceil(total / cfg.pageSize));
        if (this._page > totalPages) this._page = totalPages;
        if (this._page < 1) this._page = 1;
        var start = (this._page - 1) * cfg.pageSize;
        pageRows = rows.slice(start, start + cfg.pageSize);
      }

      // ---- Cabecera ----
      els.thead.textContent = "";
      var trH = el("tr");
      this._columns.forEach(function (col) {
        var th = el("th");
        th.scope = "col";
        if (cfg.sortable) {
          th.style.cursor = "pointer";
          th.setAttribute("role", "button");
          var span = el("span");
          span.textContent = col.label;
          th.appendChild(span);
          if (self._sortKey === col.key) {
            var arrow = el("span", "ms-1");
            arrow.textContent = self._sortDir === 1 ? "▲" : "▼";
            th.appendChild(arrow);
          }
          th.addEventListener("click", function () {
            if (self._sortKey === col.key) {
              self._sortDir = self._sortDir * -1;
            } else {
              self._sortKey = col.key;
              self._sortDir = 1;
            }
            self._render();
            self._emit("sort", { key: self._sortKey, dir: self._sortDir });
          });
        } else {
          th.textContent = col.label;
        }
        trH.appendChild(th);
      });
      els.thead.appendChild(trH);

      // ---- Cuerpo ----
      els.tbody.textContent = "";
      if (this._columns.length === 0) {
        this._renderEmptyRow(els.tbody, 1, "Sin columnas definidas.");
      } else if (pageRows.length === 0) {
        this._renderEmptyRow(els.tbody, this._columns.length, "Sin datos.");
      } else {
        pageRows.forEach(function (rowObj, idx) {
          var tr = el("tr");
          self._columns.forEach(function (col) {
            var td = el("td");
            td.textContent = safeText(rowObj[col.key]);
            tr.appendChild(td);
          });
          tr.addEventListener("click", function () {
            self._emit("row-click", { row: rowObj, index: idx });
          });
          els.tbody.appendChild(tr);
        });
      }

      // ---- Info ----
      els.info.textContent =
        total + (total === 1 ? " registro" : " registros") +
        (cfg.paginate ? " · página " + this._page + " de " + totalPages : "");

      // ---- Paginación ----
      els.pager.style.display = cfg.paginate && totalPages > 1 ? "" : "none";
      if (cfg.paginate && totalPages > 1) {
        this._renderPager(totalPages);
      } else {
        els.pagerList.textContent = "";
      }
    };

    DataTableClass.prototype._renderEmptyRow = function (tbody, colspan, message) {
      var tr = el("tr");
      var td = el("td", "text-center text-muted py-3");
      td.colSpan = colspan;
      td.textContent = message;
      tr.appendChild(td);
      tbody.appendChild(tr);
    };

    DataTableClass.prototype._renderPager = function (totalPages) {
      var self = this;
      var list = this._els.pagerList;
      list.textContent = "";

      function pageItem(label, page, disabled, active) {
        var li = el("li", "page-item");
        if (disabled) li.className += " disabled";
        if (active) li.className += " active";
        var btn = el("button", "page-link");
        btn.type = "button";
        btn.textContent = label;
        if (!disabled && !active) {
          btn.addEventListener("click", function () {
            self._page = page;
            self._render();
            self._emit("page", { page: self._page });
          });
        }
        li.appendChild(btn);
        return li;
      }

      list.appendChild(pageItem("«", this._page - 1, this._page <= 1, false));

      // Ventana de páginas alrededor de la actual.
      var startPage = Math.max(1, this._page - 2);
      var endPage = Math.min(totalPages, startPage + 4);
      startPage = Math.max(1, endPage - 4);
      for (var p = startPage; p <= endPage; p++) {
        list.appendChild(pageItem(String(p), p, false, p === this._page));
      }

      list.appendChild(
        pageItem("»", this._page + 1, this._page >= totalPages, false)
      );
    };

    // ---- Importar / Exportar ----

    DataTableClass.prototype._handleImport = function (text, filename) {
      var parsed;
      var name = (filename || "").toLowerCase();
      try {
        if (name.indexOf(".json") !== -1) {
          parsed = JSON.parse(text);
          if (!isPlainArray(parsed)) parsed = [parsed];
        } else {
          parsed = parseCSV(text);
        }
      } catch (e) {
        this._emit("error", {
          message: "No se pudo interpretar el archivo importado."
        });
        return;
      }
      // La librería NO decide qué hacer con los datos: solo los muestra en la
      // tabla como cortesía y avisa a la app mediante el evento "import".
      this._data = isPlainArray(parsed) ? parsed : [];
      if (this._columns.length === 0 && this._data.length > 0) {
        this._columns = Object.keys(this._data[0]).map(function (k) {
          return { key: k, label: k };
        });
      }
      this._page = 1;
      this._render();
      this._emit("import", { data: this._data.slice(), filename: filename });
    };

    DataTableClass.prototype._exportCSV = function () {
      if (this._columns.length === 0) return;
      var csv = toCSV(this._processed(), this._columns);
      downloadBlob("\uFEFF" + csv, "tabla-datos.csv", "text/csv;charset=utf-8;");
      this._emit("export", { format: "csv" });
    };

    DataTableClass.prototype._exportJSON = function () {
      var json = JSON.stringify(this._processed(), null, 2);
      downloadBlob(json, "tabla-datos.json", "application/json;charset=utf-8;");
      this._emit("export", { format: "json" });
    };

    // ---- Emisión de eventos ----

    DataTableClass.prototype._emit = function (name, detail) {
      this.dispatchEvent(
        new CustomEvent(name, { detail: detail, bubbles: true })
      );
      // Evento genérico "change" con el estado actual, útil para escuchar todo.
      this.dispatchEvent(
        new CustomEvent("change", {
          detail: {
            type: name,
            payload: detail,
            filter: this._filterText,
            sortKey: this._sortKey,
            sortDir: this._sortDir,
            page: this._page
          },
          bubbles: true
        })
      );
    };

    return DataTableClass;
  })();

  global.customElements.define("data-table", DataTable);
})(window);