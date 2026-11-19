/*
 * Annahme-Seite für Angebote. Der Kunde öffnet den Link (…/#<Code>), sieht das Angebot und nimmt es an oder lehnt es ab.
 *
 * Sicherheit: Alles, was vom Server kommt, wird nur mit textContent in die Seite gesetzt – nie als HTML. Der Code steht hinter dem
 * "#" und gelangt so weder in ein Zugriffsprotokoll noch in einen Verweis. Es werden keine Cookies gesetzt und nichts gespeichert.
 * Geld wird mit ganzen Zahlen (Cent) dargestellt, nicht mit Gleitkommazahlen.
 */
(function () {
  'use strict';

  var config = window.PZ_ANGEBOT || {};
  var wurzel = document.getElementById('inhalt');
  var fuss = document.getElementById('fuss');
  var NBSP = String.fromCharCode(160);
  var MINUS = String.fromCharCode(8722);
  var CODE_FORM = /^[A-Za-z0-9_-]{32,128}$/;

  // ----- kleine Helfer ------------------------------------------------------------------------------------------------
  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined && text !== null && text !== '') e.textContent = text;
    return e;
  }

  function leeren(knoten) {
    while (knoten.firstChild) knoten.removeChild(knoten.firstChild);
  }

  function tausender(n) {
    return new Intl.NumberFormat('de-DE').format(n);
  }

  /** Cent als „1.234,50 €“ (nur mit ganzen Zahlen gerechnet) */
  function euro(cent) {
    var neg = cent < 0;
    var a = Math.abs(cent);
    var rest = a % 100;
    return (
      (neg ? MINUS : '') +
      tausender(Math.floor(a / 100)) +
      ',' +
      (rest < 10 ? '0' : '') +
      rest +
      NBSP +
      '€'
    );
  }

  /** Zahl mit vier Nachkommastellen (×10.000) als Text; `minStellen` Nachkommastellen bleiben immer stehen */
  function e4Text(wert, minStellen) {
    var neg = wert < 0;
    var a = Math.abs(wert);
    var bruch = String(a % 10000);
    while (bruch.length < 4) bruch = '0' + bruch;
    while (bruch.length > minStellen && bruch.charAt(bruch.length - 1) === '0')
      bruch = bruch.slice(0, -1);
    return (
      (neg ? MINUS : '') + tausender(Math.floor(a / 10000)) + (bruch.length > 0 ? ',' + bruch : '')
    );
  }

  function prozent(bp) {
    var ganz = Math.floor(bp / 100);
    var rest = bp % 100;
    return rest === 0
      ? ganz + NBSP + '%'
      : ganz + ',' + (rest < 10 ? '0' : '') + String(rest).replace(/0$/, '') + NBSP + '%';
  }

  function datum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }

  function zeitpunkt(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return datum(iso);
      return (
        new Intl.DateTimeFormat('de-DE', {
          timeZone: 'Europe/Berlin',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(d) + ' Uhr'
      );
    } catch (_fehler) {
      return datum(iso);
    }
  }

  // ----- Verbindung zum Server ------------------------------------------------------------------------------------------
  /**
   * Eine Anfrage an die Server-Funktion. Als „text/plain“ gesendet, damit der Browser keine Vorabfrage (CORS-Preflight) braucht –
   * die Funktion liest den Inhalt trotzdem als JSON.
   */
  function anfrage(inhalt) {
    return fetch(config.funktionsUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(inhalt),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).then(function (antwort) {
      return antwort.json().then(
        function (body) {
          return { status: antwort.status, body: body };
        },
        function () {
          return { status: antwort.status, body: null };
        },
      );
    });
  }

  var NETZFEHLER =
    'Die Verbindung hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es gleich noch einmal.';

  function fehlertext(ergebnis) {
    if (ergebnis && ergebnis.body && typeof ergebnis.body.text === 'string')
      return ergebnis.body.text;
    return 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es später noch einmal.';
  }

  // ----- Anzeige --------------------------------------------------------------------------------------------------------
  /** Hinweiskasten mit Überschrift (`ebene`: h1 für ganze Seiten ohne Angebot, sonst h2) */
  function hinweis(art, titel, text, ebene) {
    var h = el('div', 'hinweis' + (art ? ' ' + art : ''));
    if (art === 'fehler') h.setAttribute('role', 'alert');
    h.appendChild(el(ebene || 'h2', 'titel', titel));
    if (text) h.appendChild(el('p', null, text));
    return h;
  }

  function zeigeFehler(titel, text) {
    leeren(wurzel);
    wurzel.appendChild(hinweis('fehler', titel, text, 'h1'));
    leeren(fuss);
  }

  function eckdatum(liste, name, wert) {
    if (!wert) return;
    var feld = el('div', 'eck');
    feld.appendChild(el('dt', null, name));
    feld.appendChild(el('dd', null, wert));
    liste.appendChild(feld);
  }

  function tabelle(a) {
    var rahmen = el('div', 'tabelle-rahmen');
    var t = el('table');
    t.setAttribute('aria-label', 'Positionen');
    var kopf = el('thead');
    var kz = el('tr');
    ['Pos.', 'Bezeichnung', 'Menge', 'Einzelpreis', 'Betrag'].forEach(function (name, i) {
      var th = el('th', i >= 2 ? 'zahl' : null, name);
      th.setAttribute('scope', 'col');
      kz.appendChild(th);
    });
    kopf.appendChild(kz);
    t.appendChild(kopf);
    var koerper = el('tbody');
    a.positionen.forEach(function (p) {
      if (p.art === 'seitenumbruch') return;
      var tr = el('tr');
      if (p.art === 'titel' || p.art === 'freitext') {
        tr.className = p.art;
        var td = el('td', null, p.bezeichnung);
        td.colSpan = 5;
        tr.appendChild(td);
      } else if (p.art === 'zwischensumme') {
        tr.className = 'zwischensumme';
        var l = el('td', null, 'Zwischensumme');
        l.colSpan = 4;
        tr.appendChild(l);
        tr.appendChild(
          el('td', 'zahl', p.zwischensumme_cent === null ? '' : euro(p.zwischensumme_cent)),
        );
      } else {
        tr.className = 'position';
        tr.appendChild(el('td', null, String(p.nr)));
        var bez = el('td', 'bez');
        bez.appendChild(document.createTextNode(p.bezeichnung));
        if (p.beschreibung) bez.appendChild(el('span', 'klein', p.beschreibung));
        if (p.miet_von) {
          var zeitraum =
            p.miet_bis && p.miet_bis !== p.miet_von
              ? datum(p.miet_von) + ' – ' + datum(p.miet_bis)
              : datum(p.miet_von);
          bez.appendChild(el('span', 'klein', 'Zeitraum: ' + zeitraum));
        }
        if (p.rabatt_cent > 0)
          bez.appendChild(el('span', 'klein', 'Rabatt ' + euro(-p.rabatt_cent)));
        if (p.optional) bez.appendChild(el('span', 'marke', 'optional'));
        else if (p.alternativ) bez.appendChild(el('span', 'marke', 'alternativ'));
        tr.appendChild(bez);
        var menge = el(
          'td',
          'zahl',
          p.art === 'kaution' ? '' : e4Text(p.menge_e4, 0) + (p.einheit ? NBSP + p.einheit : ''),
        );
        menge.setAttribute('data-label', 'Menge');
        var preis = el('td', 'zahl', e4Text(p.einzelpreis_e4, 2) + NBSP + '€');
        preis.setAttribute('data-label', 'Einzelpreis');
        var betrag = el('td', 'zahl', p.zaehlt ? euro(p.zeile_cent) : '');
        betrag.setAttribute('data-label', 'Betrag');
        tr.appendChild(menge);
        tr.appendChild(preis);
        tr.appendChild(betrag);
      }
      koerper.appendChild(tr);
    });
    t.appendChild(koerper);
    rahmen.appendChild(t);
    return rahmen;
  }

  function summen(a) {
    var s = a.summen;
    var box = el('div', 'summen');
    function zeile(name, wert, klasse) {
      var z = el('div', klasse || null);
      z.appendChild(el('span', null, name));
      z.appendChild(el('span', null, wert));
      box.appendChild(z);
    }
    if (s.gesamtrabatt_cent > 0) {
      zeile('Zwischensumme', euro(s.zwischensumme_cent));
      zeile('Rabatt', euro(-s.gesamtrabatt_cent));
    }
    if (s.steuer_cent !== 0) {
      zeile('Nettobetrag', euro(s.netto_cent));
      s.steuergruppen.forEach(function (g) {
        if (g.steuer_cent !== 0 || g.satz_bp !== 0)
          zeile('Umsatzsteuer ' + prozent(g.satz_bp), euro(g.steuer_cent));
      });
    }
    zeile('Gesamtbetrag', euro(s.brutto_cent), 'gesamt');
    return box;
  }

  function angebotKarten(a) {
    var karten = document.createDocumentFragment();

    var kopf = el('section', 'karte');
    kopf.appendChild(el('p', 'absender', a.absender.name));
    kopf.appendChild(el('h1', null, 'Angebot ' + a.nummer));
    if (a.betreff) kopf.appendChild(el('p', 'text', a.betreff));
    var daten = el('dl', 'eckdaten');
    eckdatum(daten, 'Für', a.empfaenger);
    eckdatum(daten, 'Angebotsdatum', datum(a.datum));
    eckdatum(daten, 'Gültig bis', datum(a.gueltig_bis));
    if (a.veranstaltung)
      eckdatum(
        daten,
        'Veranstaltung',
        a.veranstaltung.name + (a.veranstaltung.ort ? ', ' + a.veranstaltung.ort : ''),
      );
    kopf.appendChild(daten);
    karten.appendChild(kopf);

    var inhalt = el('section', 'karte');
    inhalt.setAttribute('aria-label', 'Leistungen und Preise');
    if (a.einleitung) inhalt.appendChild(el('p', 'text', a.einleitung));
    inhalt.appendChild(tabelle(a));
    inhalt.appendChild(summen(a));
    if (a.preis_modus === 'brutto')
      inhalt.appendChild(el('p', 'klein', 'Die Preise in der Tabelle enthalten die Umsatzsteuer.'));
    if (a.steuerhinweis) inhalt.appendChild(el('p', 'text', a.steuerhinweis));
    if (a.schlusstext) inhalt.appendChild(el('p', 'text', a.schlusstext));
    karten.appendChild(inhalt);
    return karten;
  }

  function fusszeile(a) {
    leeren(fuss);
    var teile = [
      a.absender.name,
      a.absender.inhaber,
      a.absender.strasse,
      [a.absender.plz, a.absender.ort].filter(Boolean).join(' '),
    ].filter(Boolean);
    if (teile.length > 0) fuss.appendChild(el('p', null, teile.join(', ')));
    var kontakt = el('p');
    var haengt = false;
    function anhaengen(knoten) {
      if (haengt) kontakt.appendChild(document.createTextNode(' · '));
      kontakt.appendChild(knoten);
      haengt = true;
    }
    if (a.absender.telefon) anhaengen(document.createTextNode('Telefon ' + a.absender.telefon));
    if (a.absender.email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(a.absender.email)) {
      var m = el('a', null, a.absender.email);
      m.href = 'mailto:' + a.absender.email;
      anhaengen(m);
    }
    if (config.impressumUrl && /^https?:\/\//.test(config.impressumUrl)) {
      var i = el('a', null, 'Impressum');
      i.href = config.impressumUrl;
      i.rel = 'noopener noreferrer';
      anhaengen(i);
    }
    if (config.datenschutzUrl && /^https?:\/\//.test(config.datenschutzUrl)) {
      var d = el('a', null, 'Datenschutz');
      d.href = config.datenschutzUrl;
      d.rel = 'noopener noreferrer';
      anhaengen(d);
    }
    if (haengt) fuss.appendChild(kontakt);
  }

  // ----- Antwort-Formular -----------------------------------------------------------------------------------------------
  function formular(code, daten) {
    var a = daten.angebot;
    var karte = el('section', 'karte formular');
    karte.appendChild(el('h2', null, 'Ihre Antwort'));
    var form = el('form');
    form.noValidate = true;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
    });

    var nameLabel = el('label', null, 'Ihr Name (Pflichtangabe)');
    nameLabel.htmlFor = 'antwort-name';
    var name = el('input');
    name.id = 'antwort-name';
    name.type = 'text';
    name.maxLength = 200;
    name.autocomplete = 'name';
    name.required = true;

    var kommentarLabel = el('label', null, 'Nachricht an ' + a.absender.name + ' (freiwillig)');
    kommentarLabel.htmlFor = 'antwort-kommentar';
    var kommentar = el('textarea');
    kommentar.id = 'antwort-kommentar';
    kommentar.rows = 4;
    kommentar.maxLength = 4000;

    var dsText =
      'Gespeichert werden Ihr Name, Ihre Nachricht und der Zeitpunkt Ihrer Antwort – damit ' +
      a.absender.name +
      ' Ihre Entscheidung zuordnen kann. Beim Aufruf dieser Seite entstehen technisch bedingt Zugriffsdaten (z. B. die IP-Adresse) bei den eingesetzten Diensten (Seiten-Hosting und Supabase, Rechenzentrum in der EU).';
    var ds = el('p', 'datenschutz', dsText);
    if (config.datenschutzUrl && /^https?:\/\//.test(config.datenschutzUrl)) {
      ds.appendChild(document.createTextNode(' Mehr dazu: '));
      var dl = el('a', null, 'Datenschutzerklärung');
      dl.href = config.datenschutzUrl;
      dl.rel = 'noopener noreferrer';
      ds.appendChild(dl);
      ds.appendChild(document.createTextNode('.'));
    }

    var fehler = el('p', 'fehlermeldung');
    fehler.setAttribute('role', 'alert');
    fehler.hidden = true;

    var knoepfe = el('div', 'knoepfe');
    var annehmen = el('button', null, 'Angebot annehmen');
    annehmen.type = 'button';
    var ablehnen = el('button', 'sekundaer', 'Angebot ablehnen');
    ablehnen.type = 'button';
    knoepfe.appendChild(annehmen);
    knoepfe.appendChild(ablehnen);

    var bestaetigung = el('div', 'hinweis');
    bestaetigung.hidden = true;

    function meldeFehler(text) {
      fehler.textContent = text;
      fehler.hidden = false;
    }

    function senden(antwort) {
      fehler.hidden = true;
      var n = name.value.trim();
      if (n === '') {
        meldeFehler('Bitte geben Sie Ihren Namen an.');
        name.focus();
        return;
      }
      setzeGesperrt(true);
      anfrage({
        aktion: 'antworten',
        code: code,
        antwort: antwort,
        name: n,
        kommentar: kommentar.value.trim(),
      }).then(
        function (ergebnis) {
          if (ergebnis.status === 200 && ergebnis.body && ergebnis.body.ok) {
            danke(antwort, n, a);
          } else if (ergebnis.status === 409) {
            laden(code); // schon beantwortet: den Stand anzeigen
          } else {
            setzeGesperrt(false);
            bestaetigung.hidden = true;
            knoepfe.hidden = false;
            meldeFehler(fehlertext(ergebnis));
          }
        },
        function () {
          setzeGesperrt(false);
          bestaetigung.hidden = true;
          knoepfe.hidden = false;
          meldeFehler(NETZFEHLER);
        },
      );
    }

    function setzeGesperrt(gesperrt) {
      var alle = form.querySelectorAll('button, input, textarea');
      for (var i = 0; i < alle.length; i += 1) alle[i].disabled = gesperrt;
    }

    /** Erst nachfragen, dann senden – eine Antwort lässt sich nicht zurücknehmen. */
    function nachfragen(antwort) {
      fehler.hidden = true;
      if (name.value.trim() === '') {
        meldeFehler('Bitte geben Sie Ihren Namen an.');
        name.focus();
        return;
      }
      leeren(bestaetigung);
      var frage =
        antwort === 'angenommen'
          ? 'Sie nehmen das Angebot ' + a.nummer + ' über ' + euro(a.summen.brutto_cent) + ' an.'
          : 'Sie lehnen das Angebot ' + a.nummer + ' ab.';
      bestaetigung.appendChild(el('strong', null, frage));
      bestaetigung.appendChild(
        el('p', null, 'Bitte bestätigen Sie – die Antwort lässt sich hier nicht mehr ändern.'),
      );
      var zeile = el('div', 'knoepfe');
      var ja = el(
        'button',
        antwort === 'angenommen' ? null : 'sekundaer',
        antwort === 'angenommen' ? 'Ja, jetzt annehmen' : 'Ja, jetzt ablehnen',
      );
      ja.type = 'button';
      ja.addEventListener('click', function () {
        senden(antwort);
      });
      var zurueck = el('button', 'sekundaer', 'Zurück');
      zurueck.type = 'button';
      zurueck.addEventListener('click', function () {
        bestaetigung.hidden = true;
        knoepfe.hidden = false;
        name.focus();
      });
      zeile.appendChild(ja);
      zeile.appendChild(zurueck);
      bestaetigung.appendChild(zeile);
      knoepfe.hidden = true;
      bestaetigung.hidden = false;
      ja.focus();
    }

    annehmen.addEventListener('click', function () {
      nachfragen('angenommen');
    });
    ablehnen.addEventListener('click', function () {
      nachfragen('abgelehnt');
    });

    [nameLabel, name, kommentarLabel, kommentar, ds, fehler, knoepfe, bestaetigung].forEach(
      function (k) {
        form.appendChild(k);
      },
    );
    karte.appendChild(form);
    return karte;
  }

  function danke(antwort, name, a) {
    leeren(wurzel);
    var titel =
      antwort === 'angenommen'
        ? 'Vielen Dank – Sie haben das Angebot angenommen.'
        : 'Vielen Dank – Sie haben das Angebot abgelehnt.';
    var h = hinweis(
      'gut',
      titel,
      name +
        ', Ihre Antwort zu Angebot ' +
        a.nummer +
        ' wurde gespeichert. ' +
        a.absender.name +
        ' wurde benachrichtigt. Sie können diese Seite jetzt schließen.',
    );
    h.setAttribute('role', 'status');
    h.setAttribute('data-testid', 'danke');
    wurzel.appendChild(h);
    wurzel.appendChild(angebotKarten(a));
    fusszeile(a);
    window.scrollTo(0, 0);
  }

  function zeige(code, daten) {
    var a = daten.angebot;
    leeren(wurzel);
    document.title = 'Angebot ' + a.nummer + ' – ' + a.absender.name;
    if (daten.status === 'angenommen' || daten.status === 'abgelehnt') {
      var wer = daten.antwort_name ? ' von ' + daten.antwort_name : '';
      var h = hinweis(
        daten.status === 'angenommen' ? 'gut' : '',
        daten.status === 'angenommen'
          ? 'Dieses Angebot wurde angenommen.'
          : 'Dieses Angebot wurde abgelehnt.',
        'Die Antwort' +
          wer +
          ' ist am ' +
          zeitpunkt(daten.antwort_am) +
          ' eingegangen. Eine weitere Antwort ist nicht nötig.',
      );
      h.setAttribute('data-testid', 'schon-beantwortet');
      wurzel.appendChild(h);
    } else if (daten.abgelaufen) {
      var k = [a.absender.telefon, a.absender.email].filter(Boolean).join(' · ');
      var ab = hinweis(
        '',
        'Dieses Angebot ist abgelaufen.',
        'Es war gültig bis ' +
          datum(daten.gueltig_bis) +
          '. Bitte wenden Sie sich an ' +
          a.absender.name +
          (k ? ' (' + k + ')' : '') +
          ', wenn Sie es noch annehmen möchten.',
      );
      ab.setAttribute('data-testid', 'abgelaufen');
      wurzel.appendChild(ab);
    }
    wurzel.appendChild(angebotKarten(a));
    if (daten.status === 'offen' && !daten.abgelaufen) wurzel.appendChild(formular(code, daten));
    fusszeile(a);
  }

  // ----- Start ------------------------------------------------------------------------------------------------------------
  function laden(code) {
    leeren(wurzel);
    wurzel.appendChild(el('p', 'laden', 'Das Angebot wird geladen …'));
    anfrage({ aktion: 'ansehen', code: code }).then(
      function (ergebnis) {
        if (ergebnis.status === 200 && ergebnis.body && ergebnis.body.ok && ergebnis.body.angebot) {
          zeige(code, ergebnis.body);
        } else if (ergebnis.status === 404) {
          zeigeFehler(
            'Dieser Link ist ungültig.',
            'Er ist falsch kopiert, abgelaufen oder wurde durch einen neuen ersetzt. Bitte fragen Sie beim Absender des Angebots nach einem neuen Link.',
          );
        } else {
          zeigeFehler('Das Angebot lässt sich gerade nicht laden.', fehlertext(ergebnis));
        }
      },
      function () {
        zeigeFehler('Das Angebot lässt sich gerade nicht laden.', NETZFEHLER);
      },
    );
  }

  function start() {
    if (!config.funktionsUrl) {
      zeigeFehler(
        'Diese Seite ist noch nicht eingerichtet.',
        'In der Datei config.js fehlt die Adresse der Server-Funktion.',
      );
      return;
    }
    var code = (window.location.hash || '').replace(/^#/, '').trim();
    if (!CODE_FORM.test(code)) {
      zeigeFehler(
        'Hier fehlt der Link zum Angebot.',
        'Bitte öffnen Sie den kompletten Link aus der E-Mail. Er enthält hinter dem Zeichen „#“ einen langen Code.',
      );
      return;
    }
    laden(code);
  }

  window.addEventListener('hashchange', start);
  start();
})();
