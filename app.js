/*
 * 画面表示だけを担当する（判定ロジックは checker.js の単一実装を呼ぶ）。
 * ファイルは FileReader／File.arrayBuffer でブラウザ内だけで読み込み、送信しない。
 * 利用回数の計測コードは入れていない（measurement.md M5 により公開工程で確定する）。
 */
(function () {
  'use strict';
  var Checker = window.ShopifyCsvChecker;
  var L = Checker.LEVEL;
  var LEVEL_UI = {};
  LEVEL_UI[L.ERROR] = { cls: 'err', label: '✖ 仕様不適合' };
  LEVEL_UI[L.WARN] = { cls: 'warn', label: '▲ 注意' };
  LEVEL_UI[L.NA] = { cls: 'na', label: '― 対象外・未検査' };

  var fileInput = document.getElementById('file');
  var drop = document.getElementById('drop');
  var result = document.getElementById('result');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function readBytes(file) {
    if (file.arrayBuffer) return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  function render(file, out) {
    result.classList.remove('hidden');
    document.getElementById('meta').textContent =
      'ファイル: ' + file.name + '／' + out.meta.byteLength.toLocaleString('ja-JP') + ' バイト' +
      (out.meta.headerColumns ? '／列数 ' + out.meta.headerColumns + '／データ行 ' + out.meta.dataRows : '') +
      '／検査範囲: ' + Checker.SCOPE_LINE;

    var v = document.getElementById('verdict');
    v.textContent = out.verdict;
    v.className = 'verdict ' + (out.counts[L.ERROR] > 0 ? 'has-err' : 'no-err');

    var counts = document.getElementById('counts');
    counts.textContent = '';
    [L.ERROR, L.WARN, L.NA].forEach(function (lv) {
      var li = el('li');
      li.appendChild(el('span', 'badge ' + LEVEL_UI[lv].cls, LEVEL_UI[lv].label + '：' + out.counts[lv] + ' 件'));
      counts.appendChild(li);
    });

    var tbody = document.getElementById('rows');
    tbody.textContent = '';
    out.issues.forEach(function (it) {
      var ui = LEVEL_UI[it.level];
      var tr = el('tr', ui.cls);
      var td0 = el('td');
      td0.appendChild(el('span', 'badge ' + ui.cls, ui.label));
      tr.appendChild(td0);
      tr.appendChild(el('td', 'mono', it.id));
      tr.appendChild(el('td', null, it.row == null ? '—（ファイル全体）' : String(it.row)));
      tr.appendChild(el('td', null, it.column == null ? '—' : it.column));
      tr.appendChild(el('td', null, it.cause));
      var td5 = el('td', null, it.expected);
      if (it.detail) {
        td5.appendChild(el('br'));
        td5.appendChild(el('span', 'muted', it.detail));
      }
      tr.appendChild(td5);
      tbody.appendChild(tr);
    });
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handle(file) {
    if (!file) return;
    readBytes(file).then(function (bytes) {
      render(file, Checker.check(bytes, { fileName: file.name }));
    }).catch(function (e) {
      result.classList.remove('hidden');
      document.getElementById('verdict').textContent = 'ファイルを読み込めませんでした: ' + (e && e.message ? e.message : e);
    });
  }

  fileInput.addEventListener('change', function () { handle(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) handle(e.dataTransfer.files[0]);
  });
})();
