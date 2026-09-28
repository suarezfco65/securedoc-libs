/*!
 * Tasa de Cambio — librería reutilizable (un solo archivo, JS puro)
 * Expone un único objeto global de namespace: window.TasaCambio
 * No es una app: no pinta pantalla, no toca el DOM de quien la carga,
 * no lee ni escribe en SecureDoc ni en ninguna base de datos.
 * Solo recibe parámetros y devuelve Promesas con el resultado.
 */
(function (global) {
  "use strict";

  // Evita redeclarar si ya se cargó en la misma página.
  if (global.TasaCambio) { return; }

  var BASE = "https://ve.dolarapi.com/v1/historicos";
  var MENSAJE_CORS = "No se puede consultar este servicio desde una página web.";
  var MAX_RETROCESO_DIAS = 7; // Si es feriado/sin dato, busca hacia atrás hasta 7 días.

  // Tipos aceptados -> ruta {moneda}/{fuente} del servicio.
  // Las claves están normalizadas (minúsculas, sin acentos) y se aceptan
  // varios sinónimos ("libre" = "paralelo", "usd" = "dolar", "eur" = "euro").
  var MAPA_TIPOS = {
    "dolar oficial":  { moneda: "dolares", fuente: "oficial" },
    "dolar libre":    { moneda: "dolares", fuente: "paralelo" },
    "euro oficial":   { moneda: "euros",   fuente: "oficial" },
    "euro libre":     { moneda: "euros",   fuente: "paralelo" }
  };

  function normalizar(texto) {
    return String(texto == null ? "" : texto)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // quita acentos
      .replace(/\s+/g, " ")
      // Sinónimos frecuentes -> forma canónica.
      .replace(/\busd\b/g, "dolar")
      .replace(/\bdolares\b/g, "dolar")
      .replace(/\beur\b/g, "euro")
      .replace(/\beuros\b/g, "euro")
      .replace(/\bparalelo\b/g, "libre");
  }

  // Acepta: Date, "YYYY-MM-DD", "DD/MM/YYYY" o timestamp numérico.
  // Devuelve un Date en fecha LOCAL (no UTC), a las 00:00, o null si es inválida.
  function aDateLocal(fecha) {
    var d;
    if (fecha instanceof Date) {
      d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    } else if (typeof fecha === "number") {
      var t = new Date(fecha);
      d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    } else {
      var s = String(fecha == null ? "" : fecha).trim();
      var mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      var mDMY = s.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
      if (mISO) {
        d = new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]));
      } else if (mDMY) {
        d = new Date(Number(mDMY[3]), Number(mDMY[2]) - 1, Number(mDMY[1]));
      } else {
        var g = new Date(s);
        d = isNaN(g.getTime())
          ? null
          : new Date(g.getFullYear(), g.getMonth(), g.getDate());
      }
    }
    if (!d || isNaN(d.getTime())) { return null; }
    return d;
  }

  // Descompone un Date local en { anio, mes, dia } con ceros a la izquierda.
  function partesDe(d) {
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return {
      anio: String(d.getFullYear()),
      mes: (mm < 10 ? "0" : "") + mm,
      dia: (dd < 10 ? "0" : "") + dd
    };
  }

  // De la respuesta (array u objeto) saca el número: promedio || venta || compra.
  function extraerValor(datos) {
    var reg = Array.isArray(datos) ? datos[datos.length - 1] : datos;
    if (!reg || typeof reg !== "object") { return null; }
    var v = (reg.promedio != null) ? reg.promedio
          : (reg.venta != null)    ? reg.venta
          : (reg.compra != null)   ? reg.compra
          : null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // Consulta UN día concreto.
  // Resuelve { tasa:Number|null, url:String }: tasa null = ese día no tiene dato.
  // Rechaza SOLO ante fallo de red/CORS (para no seguir intentando en vano).
  function consultarDia(cfg, d) {
    var p = partesDe(d);
    var url = BASE + "/" + cfg.moneda + "/" + cfg.fuente +
              "/" + p.anio + "/" + p.mes + "/" + p.dia;
    return fetch(url)
      .then(function (resp) {
        if (resp.status === 404) { return { tasa: null, url: url }; }
        if (!resp.ok) { throw new Error("HTTP " + resp.status); }
        return resp.json().then(function (datos) {
          return { tasa: extraerValor(datos), url: url };
        });
      })
      .catch(function (e) {
        // Un HTTP no-ok o error de parseo lo tratamos como "sin dato" (día siguiente),
        // pero un fallo de red real (fetch rechaza) lo propagamos como CORS.
        if (e && e.message && e.message.indexOf("HTTP ") === 0) {
          return { tasa: null, url: url };
        }
        throw new Error(MENSAJE_CORS);
      });
  }

  var TasaCambio = {
    // Lista de tipos válidos (por si la app quiere armar un selector).
    tipos: function () {
      return ["Dolar oficial", "Dolar libre", "Euro oficial", "Euro libre"];
    },

    /**
     * Obtiene la tasa de cambio de una fecha y un tipo.
     * Si ese día no hay valor (feriado/fin de semana), retrocede día a día
     * hasta un máximo de 7 días atrás y devuelve el primero que tenga tasa.
     *
     * @param {Date|string|number} fecha  Date, "YYYY-MM-DD", "DD/MM/YYYY" o timestamp.
     * @param {string} tipo               "Dolar oficial", "Dolar libre",
     *                                     "Euro oficial" o "Euro libre".
     * @returns {Promise<Object>} {
     *            tipo, fechaSolicitada:"YYYY-MM-DD", fecha:"YYYY-MM-DD" (la usada),
     *            tasa:Number, diasRetrocedidos:Number, moneda, fuente, url
     *          }
     *          Rechaza con Error(message); usa MENSAJE_CORS si la red/CORS falla,
     *          o avisa si en 7 días atrás no hubo ninguna tasa.
     */
    obtener: function (fecha, tipo) {
      return new Promise(function (resolve, reject) {
        var clave = normalizar(tipo);
        var cfg = MAPA_TIPOS[clave];
        if (!cfg) {
          reject(new Error(
            'Tipo no válido. Usa "Dolar oficial", "Dolar libre", ' +
            '"Euro oficial" o "Euro libre".'
          ));
          return;
        }

        var base = aDateLocal(fecha);
        if (!base) {
          reject(new Error('Fecha no válida. Usa un Date, "YYYY-MM-DD" o "DD/MM/YYYY".'));
          return;
        }

        var pBase = partesDe(base);
        var fechaSolicitada = pBase.anio + "-" + pBase.mes + "-" + pBase.dia;

        // Intenta el día 'offset' hacia atrás (0 = fecha pedida).
        function intentar(offset) {
          if (offset > MAX_RETROCESO_DIAS) {
            reject(new Error(
              "No hay tasa disponible para esa fecha ni en los " +
              MAX_RETROCESO_DIAS + " días anteriores."
            ));
            return;
          }
          var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset);
          consultarDia(cfg, d).then(function (res) {
            if (res.tasa == null) {
              intentar(offset + 1); // feriado/sin dato: probar día anterior
              return;
            }
            var p = partesDe(d);
            resolve({
              tipo: tipo,
              fechaSolicitada: fechaSolicitada,
              fecha: p.anio + "-" + p.mes + "-" + p.dia, // fecha realmente usada
              tasa: res.tasa,
              diasRetrocedidos: offset,
              moneda: cfg.moneda,
              fuente: cfg.fuente,
              url: res.url
            });
          }).catch(function (e) {
            reject(e); // fallo de red/CORS: cortar sin seguir intentando
          });
        }

        intentar(0);
      });
    }
  };

  global.TasaCambio = TasaCambio;
})(typeof window !== "undefined" ? window : this);