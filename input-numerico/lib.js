(function () {
  "use strict";

  // Evita registrar dos veces si la librería se carga más de una vez.
  if (window.customElements && customElements.get("input-numero")) {
    return;
  }

  /**
   * Convierte el texto en una lista de tokens (números, operadores, paréntesis).
   * Lanza un error si aparece un carácter no permitido.
   */
  function tokenize(str) {
    var tokens = [];
    var i = 0;
    function isDigit(c) {
      return c >= "0" && c <= "9";
    }
    while (i < str.length) {
      var c = str[i];
      if (c === " " || c === "\t") {
        i++;
        continue;
      }
      if (isDigit(c) || c === ".") {
        var num = "";
        var dot = false;
        while (i < str.length && (isDigit(str[i]) || str[i] === ".")) {
          if (str[i] === ".") {
            if (dot) throw new Error("numero_invalido");
            dot = true;
          }
          num += str[i];
          i++;
        }
        if (num === "" || num === ".") throw new Error("numero_invalido");
        tokens.push({ t: "num", v: parseFloat(num) });
        continue;
      }
      if (
        c === "+" || c === "-" || c === "*" ||
        c === "/" || c === "^" || c === "(" || c === ")"
      ) {
        tokens.push({ t: "op", v: c });
        i++;
        continue;
      }
      throw new Error("caracter_invalido");
    }
    return tokens;
  }

  /**
   * Evalúa una expresión aritmética con + - * / , potencia (^) y paréntesis.
   * Analizador de descenso recursivo (sin eval/Function). Lanza error si algo
   * es inválido o si hay división por cero.
   */
  function evaluate(str) {
    var tokens = tokenize(str);
    if (tokens.length === 0) throw new Error("vacio");
    var pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr() {
      var val = parseTerm();
      while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
        var op = next().v;
        var r = parseTerm();
        val = op === "+" ? val + r : val - r;
      }
      return val;
    }
    function parseTerm() {
      var val = parsePower();
      while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
        var op = next().v;
        var r = parsePower();
        if (op === "/") {
          if (r === 0) throw new Error("division_por_cero");
          val = val / r;
        } else {
          val = val * r;
        }
      }
      return val;
    }
    function parsePower() {
      var base = parseUnary();
      if (peek() && peek().t === "op" && peek().v === "^") {
        next();
        var exp = parsePower(); // asociativo por la derecha
        return Math.pow(base, exp);
      }
      return base;
    }
    function parseUnary() {
      if (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
        var op = next().v;
        var val = parseUnary();
        return op === "-" ? -val : val;
      }
      return parsePrimary();
    }
    function parsePrimary() {
      var tk = peek();
      if (!tk) throw new Error("fin_inesperado");
      if (tk.t === "num") {
        next();
        return tk.v;
      }
      if (tk.t === "op" && tk.v === "(") {
        next();
        var val = parseExpr();
        var cl = next();
        if (!cl || cl.v !== ")") throw new Error("parentesis");
        return val;
      }
      throw new Error("token_inesperado");
    }

    var result = parseExpr();
    if (pos !== tokens.length) throw new Error("sobra_contenido");
    if (typeof result !== "number" || !isFinite(result)) throw new Error("resultado_invalido");
    return result;
  }

  var InputNumero = class extends HTMLElement {
    static get observedAttributes() {
      return [
        "value", "min", "max", "decimals",
        "required", "allow-negatives",
        "placeholder", "disabled", "readonly"
      ];
    }

    constructor() {
      super();
      this._input = null;
      this._value = null;        // valor numérico oficial (o null)
      this._expression = "";     // texto crudo que escribió el usuario
      this._valid = true;        // estado de validez actual
      this._built = false;
    }

    connectedCallback() {
      this._build();
      this._syncFromAttributes();
    }

    _build() {
      if (this._built) return;
      var input = document.createElement("input");
      input.type = "text";
      input.setAttribute("inputmode", "text");
      input.className = "form-control"; // hereda estilos Bootstrap de la app
      var self = this;
      input.addEventListener("input", function () {
        self._expression = self._input.value;
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          self._resolve();
        }
      });
      input.addEventListener("blur", function () {
        self._resolve();
      });
      input.addEventListener("focus", function () {
        // Al editar, mostramos de nuevo la expresión original.
        self._input.value = self._expression;
      });
      this.appendChild(input);
      this._input = input;
      this._built = true;
    }

    // ---- Lectura de configuración desde atributos ----
    _decimals() {
      if (!this.hasAttribute("decimals")) return null;
      var d = parseInt(this.getAttribute("decimals"), 10);
      return isNaN(d) || d < 0 ? null : d;
    }
    _min() {
      if (!this.hasAttribute("min")) return null;
      var n = parseFloat(this.getAttribute("min"));
      return isNaN(n) ? null : n;
    }
    _max() {
      if (!this.hasAttribute("max")) return null;
      var n = parseFloat(this.getAttribute("max"));
      return isNaN(n) ? null : n;
    }
    _required() {
      return this.hasAttribute("required") && this.getAttribute("required") !== "false";
    }
    _allowNegatives() {
      if (!this.hasAttribute("allow-negatives")) return true;
      return this.getAttribute("allow-negatives") !== "false";
    }

    _format(num) {
      var dec = this._decimals();
      return dec != null ? num.toFixed(dec) : String(num);
    }

    _applyError(msg) {
      if (!this._input) return;
      if (msg) {
        this._input.classList.add("is-invalid");
        this._input.setAttribute("title", msg);
      } else {
        this._input.classList.remove("is-invalid");
        this._input.removeAttribute("title");
      }
    }

    _emit() {
      this.dispatchEvent(new CustomEvent("change", {
        detail: {
          value: this._value,
          expression: this._expression,
          valid: this._valid
        },
        bubbles: true
      }));
    }

    /**
     * Resuelve la expresión escrita: calcula, redondea, valida límites y
     * negativos. Si algo falla, marca error y NO acepta el valor.
     */
    _resolve() {
      if (!this._input) return;
      this._expression = this._input.value;
      var raw = (this._input.value || "").trim();

      // Campo vacío
      if (raw === "") {
        this._value = null;
        if (this._required()) {
          this._valid = false;
          this._applyError("Este campo es obligatorio");
        } else {
          this._valid = true;
          this._applyError("");
        }
        this._input.value = "";
        this._emit();
        return;
      }

      // Intentar calcular
      var num;
      try {
        num = evaluate(raw);
      } catch (err) {
        this._valid = false;
        this._applyError("Expresión no válida");
        this._emit(); // no se cambia el valor oficial anterior
        return;
      }

      // Redondeo a los decimales configurados
      var dec = this._decimals();
      if (dec != null) {
        num = Number(num.toFixed(dec));
      }

      // Negativos
      if (!this._allowNegatives() && num < 0) {
        this._valid = false;
        this._applyError("No se permiten valores negativos");
        this._emit();
        return;
      }

      // Límites mínimo / máximo (sobre el resultado ya calculado)
      var mn = this._min();
      var mx = this._max();
      if (mn != null && num < mn) {
        this._valid = false;
        this._applyError("El valor es menor que el mínimo (" + mn + ")");
        this._emit();
        return;
      }
      if (mx != null && num > mx) {
        this._valid = false;
        this._applyError("El valor es mayor que el máximo (" + mx + ")");
        this._emit();
        return;
      }

      // Válido
      this._value = num;
      this._valid = true;
      this._applyError("");
      this._input.value = this._format(num);
      this._emit();
    }

    _setValueFromString(str) {
      if (!this._built) this._build();
      this._input.value = str == null ? "" : String(str);
      this._resolve();
    }

    _syncFromAttributes() {
      if (!this._input) return;
      this._input.placeholder = this.getAttribute("placeholder") || "";
      this._input.disabled = this.hasAttribute("disabled");
      this._input.readOnly = this.hasAttribute("readonly");
      if (this.hasAttribute("value")) {
        this._setValueFromString(this.getAttribute("value"));
      }
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (!this._built) return; // se sincroniza al conectarse
      switch (name) {
        case "placeholder":
          this._input.placeholder = newVal || "";
          break;
        case "disabled":
          this._input.disabled = this.hasAttribute("disabled");
          break;
        case "readonly":
          this._input.readOnly = this.hasAttribute("readonly");
          break;
        case "value":
          this._setValueFromString(newVal);
          break;
        default:
          // min, max, decimals, required, allow-negatives:
          // se aplican en la próxima resolución del campo.
          break;
      }
    }

    // ---- Propiedades JS públicas ----
    get value() { return this._value; }
    set value(v) { this._setValueFromString(v == null ? "" : String(v)); }

    get expression() { return this._expression; }

    get valid() { return this._valid; }
  };

  customElements.define("input-numero", InputNumero);
})();