/*
 * 画面表示だけを担当する（判定ロジックは checker.js の単一実装を呼ぶ）。
 * ファイルは FileReader／File.arrayBuffer でブラウザ内だけで読み込み、送信しない。
 * 利用回数の計測（measurement.md M5）：診断を1回実行して結果を表示した直後にだけ、
 * GoatCounter（自前ホストの count.js）へイベント path='check-run' を1回送る。
 * ページビューは数えない（index.html の data-goatcounter-settings で no_onload）。
 * ファイル名・診断結果・行数などは送らない（path／title は固定文字列、referrer は空）。
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

  // 診断実行の匿名イベント。固定値のみを渡し、ファイル由来の値は一切含めない。
  // count.js が読み込めない（広告ブロッカー等）場合は何もしない（診断には影響させない）。
  function countCheckRun() {
    try {
      var gc = window.goatcounter;
      if (gc && typeof gc.count === 'function') {
        gc.count({ path: 'check-run', title: 'check-run', referrer: '', event: true });
      }
    } catch (e) { /* 計測の失敗は無視する */ }
  }

  function handle(file) {
    if (!file) return;
    readBytes(file).then(function (bytes) {
      render(file, Checker.check(bytes, { fileName: file.name }));
      countCheckRun();
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
