/*
 * Shopify商品CSV 事前チェッカー — 判定ロジック（単一実装）
 *
 * 仕様の正本: spec-v1.md（凍結済み 2026-11-17）。検査項目 C01〜C48。
 * 対象＝Shopify商品CSV・標準テンプレート・バリエーションなし・1商品1レコード・新規下書き登録のみ。
 *
 * - ブラウザ（index.html から <script src="checker.js">）と Node（tests/run-tests.mjs）の両方から使う。
 * - 外部通信は一切しない。入力はバイト列（Uint8Array）のみ。
 * - 本ツールは非公式であり、インポートの成功を保証しない。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ShopifyCsvChecker = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 定数
  // ---------------------------------------------------------------------------

  var LEVEL = {
    ERROR: '仕様不適合',
    WARN: '注意',
    NA: '対象外・未検査'
  };

  var SCOPE_LINE =
    '対象＝Shopify商品CSV・標準テンプレート・バリエーションなし・1商品1レコード・新規下書き登録のみ';

  // C03: 15 MB。MB の定義（10進/2進）は公式で未確認のため、
  // 2進（15×1024×1024）超過を仕様不適合、10進（15,000,000）超過〜2進以下を注意とする（保守側）。
  var LIMIT_BYTES_BINARY = 15 * 1024 * 1024; // 15,728,640
  var LIMIT_BYTES_DECIMAL = 15 * 1000 * 1000; // 15,000,000

  // §5-A S5 サンプル実ファイルのヘッダー（61列）
  var S5_HEADER = [
    'Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags',
    'Published on online store', 'Status', 'SKU', 'Variant Barcodes',
    'Option1 name', 'Option1 value', 'Option1 Linked To',
    'Option2 name', 'Option2 value', 'Option2 Linked To',
    'Option3 name', 'Option3 value', 'Option3 Linked To',
    'Price', 'Compare-at price', 'Cost per item', 'Charge tax', 'Tax code',
    'Unit price total measure', 'Unit price total measure unit',
    'Unit price base measure', 'Unit price base measure unit',
    'Inventory tracker', 'Inventory quantity', 'Continue selling when out of stock',
    'Weight value (grams)', 'Weight unit for display', 'Requires shipping', 'Fulfillment service',
    'Product image URL', 'Image position', 'Image alt text', 'Variant image URL', 'Gift card',
    'SEO title', 'SEO description', 'Color (product.metafields.shopify.color-pattern)',
    'Google Shopping / Google product category', 'Google Shopping / Gender',
    'Google Shopping / Age group', 'Google Shopping / Manufacturer part number (MPN)',
    'Google Shopping / Ad group name', 'Google Shopping / Ads labels',
    'Google Shopping / Condition', 'Google Shopping / Custom product',
    'Google Shopping / Custom label 0', 'Google Shopping / Custom label 1',
    'Google Shopping / Custom label 2', 'Google Shopping / Custom label 3',
    'Google Shopping / Custom label 4',
    'Packed product length', 'Packed product width', 'Packed product height',
    'Packed product dimension unit'
  ];

  // §5-B S1 説明表にあってサンプルにない固定列（表記差既知のものを含む）。
  // Included / International は §5-C で「固定列の扱いを優先」とされているため固定列に含める。
  var S1_EXTRA = [
    'Collection', 'Price / International', 'Compare-at price / International', 'Included / International',
    'Barcodes', 'Option1 LinkedTo', 'Google Shopping / Google Product Category',
    'Google Shopping / Gender', 'Google Shopping / Age Group', 'Google Shopping / MPN',
    'Google Shopping / Condition', 'Google Shopping / Custom Product',
    'Google Shopping / Custom Label 0', 'Google Shopping / Custom Label 1',
    'Google Shopping / Custom Label 2', 'Google Shopping / Custom Label 3',
    'Google Shopping / Custom Label 4'
  ];

  // §5-B 表記差既知（S1 表記 ↔ S5 表記）。不適合にしないが受理可否は公式未確認と表示する。
  var SPELLING_PAIRS = {
    'Barcodes': 'Variant Barcodes',
    'Variant Barcodes': 'Barcodes',
    'Option1 LinkedTo': 'Option1 Linked To',
    'Option1 Linked To': 'Option1 LinkedTo',
    'Google Shopping / Google Product Category': 'Google Shopping / Google product category',
    'Google Shopping / Google product category': 'Google Shopping / Google Product Category'
  };

  // §5-C パターン候補・未確認
  var PATTERN_CANDIDATES = ['Option2 LinkedTo', 'Option3 LinkedTo'];

  // §5-D 旧列名リスト
  var LEGACY_COLUMNS = [
    'Handle', 'Body (HTML)', 'Published', 'Option1 Name', 'Variant SKU', 'Variant Grams',
    'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
    'Variant Fulfillment Service', 'Variant Price', 'Variant Compare-at Price',
    'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Barcode',
    'Image Src', 'Image Alt Text'
  ];

  var FIXED_SET = {};
  S5_HEADER.concat(S1_EXTRA).forEach(function (n) { FIXED_SET[n] = true; });
  var LEGACY_SET = {};
  LEGACY_COLUMNS.forEach(function (n) { LEGACY_SET[n] = true; });

  var MARKET_RE = /^(Included|Price|Compare At Price) \/ (.+)$/;

  var PRICE_FIXED = ['Price', 'Compare-at price', 'Cost per item', 'Price / International', 'Compare-at price / International'];
  var BOOL_FIXED = ['Published on online store', 'Charge tax', 'Requires shipping', 'Gift card', 'Included / International'];
  var TAX_UNIT_COLUMNS = ['Tax code', 'Unit price total measure', 'Unit price total measure unit', 'Unit price base measure', 'Unit price base measure unit'];
  var GOOGLE_CATEGORY_COLUMNS = ['Google Shopping / Google Product Category', 'Google Shopping / Google product category'];
  var FREE_TEXT_COLUMNS = ['Description', 'Vendor', 'Type'];

  var FULFILLMENT_KNOWN = ['manual', 'shipwire', 'webgistix', 'amazon_marketplace_web'];
  var TRACKER_KNOWN = ['shopify', 'shipwire', 'amazon_marketplace_web'];
  var STATUS_KNOWN = ['active', 'draft', 'archived'];
  var POLICY_KNOWN = ['deny', 'continue'];
  var WEIGHT_UNITS = ['g', 'kg', 'lb', 'oz'];
  var DIM_UNITS = ['cm', 'in'];
  var PACKED_COLUMNS = ['Packed product length', 'Packed product width', 'Packed product height', 'Packed product dimension unit'];

  var CASE_NOTE = '公式の説明表は小文字表記です。大文字・小文字の受理範囲は公式では確認できていません';

  // ---------------------------------------------------------------------------
  // 列名の分類（spec §1 分類表、§5）
  // ---------------------------------------------------------------------------

  function classifyColumn(name) {
    if (FIXED_SET[name]) {
      if (SPELLING_PAIRS[name]) return { kind: 'spelling', counterpart: SPELLING_PAIRS[name] };
      if (name.indexOf(' (product.metafields.') > 0) return { kind: 'known', metafield: true };
      if (name === 'Included / International') return { kind: 'known', market: true };
      return { kind: 'known' };
    }
    if (PATTERN_CANDIDATES.indexOf(name) >= 0) return { kind: 'candidate' };
    if (LEGACY_SET[name]) return { kind: 'legacy' };
    var m = MARKET_RE.exec(name);
    if (m && m[2].trim() !== '') return { kind: 'pattern', market: true, marketPrefix: m[1], marketName: m[2] };
    var mi = name.indexOf(' (product.metafields.');
    if (mi > 0 && name.charAt(name.length - 1) === ')' && name.length > mi + ' (product.metafields.'.length + 1) {
      return { kind: 'pattern', metafield: true };
    }
    return { kind: 'unknown' };
  }

  // ---------------------------------------------------------------------------
  // バイト列の検査（C01〜C04）
  // ---------------------------------------------------------------------------

  // 最初の不正な UTF-8 バイト位置を返す（なければ -1）
  function findInvalidUtf8(bytes, start) {
    var i = start || 0;
    var n = bytes.length;
    while (i < n) {
      var b = bytes[i];
      if (b < 0x80) { i++; continue; }
      var need, min;
      if (b >= 0xC2 && b <= 0xDF) { need = 1; min = 0x80; }
      else if (b >= 0xE0 && b <= 0xEF) { need = 2; min = 0x800; }
      else if (b >= 0xF0 && b <= 0xF4) { need = 3; min = 0x10000; }
      else return i;
      if (i + need > n - 1) return i; // 途中で切れている
      var cp = b & (need === 1 ? 0x1F : need === 2 ? 0x0F : 0x07);
      for (var k = 1; k <= need; k++) {
        var c = bytes[i + k];
        if (c === undefined || (c & 0xC0) !== 0x80) return i;
        cp = (cp << 6) | (c & 0x3F);
      }
      if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return i;
      i += need + 1;
    }
    return -1;
  }

  function lineOfByte(bytes, offset) {
    var line = 1;
    for (var i = 0; i < offset && i < bytes.length; i++) if (bytes[i] === 0x0A) line++;
    return line;
  }

  function hexBytes(bytes, from, count) {
    var out = [];
    for (var i = from; i < from + count && i < bytes.length; i++) {
      out.push(('0' + bytes[i].toString(16).toUpperCase()).slice(-2));
    }
    return out.join(' ');
  }

  function decodeUtf8(bytes) {
    // 検証済みの UTF-8 をデコードする（TextDecoder が使える環境では使う）
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes);
    }
    /* istanbul ignore next */
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function countLineEndingsBytes(bytes) {
    var crlf = 0, lf = 0, cr = 0;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x0D) {
        if (bytes[i + 1] === 0x0A) { crlf++; i++; } else { cr++; }
      } else if (bytes[i] === 0x0A) {
        lf++;
      }
    }
    return { crlf: crlf, lf: lf, cr: cr };
  }

  // ---------------------------------------------------------------------------
  // CSV パーサ（C05 の構文エラーを記録しながら読む）
  // ---------------------------------------------------------------------------

  function parseCsv(text) {
    var records = [];
    var errors = [];
    var fields = [];
    var quotedFlags = [];
    var field = '';
    var inQuotes = false;
    var fieldQuoted = false;
    var afterClose = false;
    var afterCloseReported = false;
    var quoteStartLine = 1;
    var line = 1;
    var recStartLine = 1;
    var recHasChars = false;
    var i = 0;
    var n = text.length;

    function endField() {
      fields.push(field);
      quotedFlags.push(fieldQuoted);
      field = '';
      fieldQuoted = false;
      afterClose = false;
      afterCloseReported = false;
    }
    function endRecord(endLine) {
      records.push({ fields: fields, quoted: quotedFlags, line: recStartLine, endLine: endLine });
      fields = [];
      quotedFlags = [];
      recHasChars = false;
    }

    while (i < n) {
      var c = text.charAt(i);
      if (inQuotes) {
        recHasChars = true;
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
          afterClose = true;
          i++;
          continue;
        }
        if (c === '\r' && text.charAt(i + 1) === '\n') { field += '\r\n'; i += 2; line++; continue; }
        if (c === '\n' || c === '\r') { field += c; i++; line++; continue; }
        field += c;
        i++;
        continue;
      }
      if (c === ',') { recHasChars = true; endField(); i++; continue; }
      if (c === '\r' || c === '\n') {
        endField();
        endRecord(line);
        if (c === '\r' && text.charAt(i + 1) === '\n') i += 2; else i++;
        line++;
        recStartLine = line;
        continue;
      }
      recHasChars = true;
      if (c === '"') {
        if (field.length === 0 && !fieldQuoted && !afterClose) {
          inQuotes = true;
          fieldQuoted = true;
          quoteStartLine = line;
          i++;
          continue;
        }
        errors.push({
          line: line,
          column: fields.length + 1,
          kind: afterClose ? 'after-close' : 'stray',
          message: afterClose
            ? '引用符で囲んだ値の閉じ引用符の直後に、区切りのカンマ以外の文字（引用符）があります'
            : '引用符で囲まれていない値の途中に引用符（"）があります（不足・余分な引用符、または値内の引用符の二重化漏れの可能性）'
        });
        if (afterClose) afterCloseReported = true;
        field += c;
        i++;
        continue;
      }
      if (afterClose && !afterCloseReported) {
        errors.push({
          line: line,
          column: fields.length + 1,
          kind: 'after-close',
          message: '引用符で囲んだ値の閉じ引用符の直後に、区切りのカンマ以外の文字があります（値の途中の引用符が二重化されていない可能性）'
        });
        afterCloseReported = true;
      }
      field += c;
      i++;
    }
    if (inQuotes) {
      errors.push({
        line: quoteStartLine,
        column: fields.length + 1,
        kind: 'unterminated',
        message: '引用符で始まった値が、ファイルの最後まで閉じられていません（閉じ引用符の不足）'
      });
    }
    if (recHasChars || field.length > 0 || fields.length > 0 || fieldQuoted) {
      endField();
      endRecord(line);
    }
    return { records: records, errors: errors };
  }

  // ---------------------------------------------------------------------------
  // 小道具
  // ---------------------------------------------------------------------------

  function charLength(s) {
    var count = 0;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
        var next = s.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) i++;
      }
      count++;
    }
    return count;
  }

  function isNumber(s) {
    return /^-?\d+(\.\d+)?$/.test(s);
  }

  var CURRENCY_RE = /[$¥￥€£₩₹円]|\b(USD|JPY|EUR|GBP|CAD|AUD)\b/i;

  function rowLabel(row) { return '物理行 ' + row; }

  function quoteVal(v) {
    var s = String(v);
    if (charLength(s) > 60) s = s.slice(0, 57) + '…';
    return '「' + s + '」';
  }

  // 列挙値の判定: 'ok' | 'case' | 'invalid'
  function enumCheck(value, allowed) {
    if (allowed.indexOf(value) >= 0) return 'ok';
    if (allowed.indexOf(value.toLowerCase()) >= 0) return 'case';
    return 'invalid';
  }

  // ---------------------------------------------------------------------------
  // メイン
  // ---------------------------------------------------------------------------

  function check(input, options) {
    options = options || {};
    var bytes = toBytes(input);
    var issues = [];
    var meta = {
      scope: SCOPE_LINE,
      fileName: options.fileName || null,
      byteLength: bytes.length,
      hasBom: false,
      utf8: true,
      lineEndings: null,
      headerColumns: 0,
      dataRows: 0,
      legacyMode: false,
      checkedRows: [],
      outOfScopeRows: []
    };

    function add(id, level, o) {
      o = o || {};
      issues.push({
        id: id,
        level: level,
        row: o.row == null ? null : o.row,
        column: o.column == null ? null : o.column,
        cause: o.cause || '',
        expected: o.expected || '',
        detail: o.detail || ''
      });
    }

    // ---- C02 BOM -----------------------------------------------------------
    var start = 0;
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      meta.hasBom = true;
      start = 3;
      add('C02', LEVEL.WARN, {
        cause: 'ファイル先頭に BOM（バイト列 EF BB BF）があります（事実の検出です）。',
        expected: 'BOM の扱い（BOM付きUTF-8が受理されるか）は、公式のヘルプでは確認できていません。BOM を禁止する・エラーとする公式の記述は見つかっていません。文字化けなどの問題が起きる場合の切り分けの参考にしてください。',
        detail: '先頭バイト列: ' + hexBytes(bytes, 0, 3)
      });
    }

    // ---- C03 サイズ --------------------------------------------------------
    var sizeText = bytes.length.toLocaleString ? bytes.length.toLocaleString('en-US') : String(bytes.length);
    if (bytes.length > LIMIT_BYTES_BINARY) {
      add('C03', LEVEL.ERROR, {
        cause: 'ファイルサイズが ' + sizeText + ' バイトで、15 MB を超えています。',
        expected: '15 MB 以下。超える場合は、ファイルを複数に分割してください（各ファイルの1行目に同じ列ヘッダーを付けます）。',
        detail: '判定基準: 15 MB = 15×1024×1024 = 15,728,640 バイトを超えた場合に仕様不適合としています。'
      });
    } else if (bytes.length > LIMIT_BYTES_DECIMAL) {
      add('C03', LEVEL.WARN, {
        cause: 'ファイルサイズが ' + sizeText + ' バイトで、15 MB の上限に近い（10進の 15,000,000 バイトを超えている）状態です。',
        expected: '15 MB 以下。MB の数え方（1,000,000 か 1,048,576 か）は公式では確認できていないため、念のため分割を検討してください。'
      });
    }

    // ---- C01 UTF-8 ---------------------------------------------------------
    var bad = findInvalidUtf8(bytes, start);
    var le = countLineEndingsBytes(bytes);
    meta.lineEndings = le;
    if (bad >= 0) {
      meta.utf8 = false;
      add('C01', LEVEL.ERROR, {
        row: lineOfByte(bytes, bad),
        cause: 'UTF-8 として解釈できないバイト列があります（ファイル先頭から ' + bad + ' バイト目: ' + hexBytes(bytes, bad, 4) + '）。ファイルが UTF-8 で保存されていない可能性があります。',
        expected: 'UTF-8 で保存されたCSVファイル。UTF-8 で保存し直してから、もう一度チェックしてください。'
      });
      add('C05', LEVEL.NA, {
        cause: '文字コードが UTF-8 として解釈できないため、CSV構文・列名・値の検査（C05〜C39）は実施していません。',
        expected: 'UTF-8 で保存し直してから再度チェックしてください。'
      });
      addLineEndingInfo(add, le);
      addStanding(add, null, true);
      return finish(issues, meta);
    }

    var text = decodeUtf8(bytes.subarray ? bytes.subarray(start) : bytes.slice(start));

    // ---- C04 改行形式（参考情報） -------------------------------------------
    addLineEndingInfo(add, le);

    // ---- パース ------------------------------------------------------------
    var parsed = parseCsv(text);
    var records = parsed.records;

    // ---- C05 構文 ----------------------------------------------------------
    parsed.errors.forEach(function (e) {
      add('C05', LEVEL.ERROR, {
        row: e.line,
        cause: e.message + '（' + e.column + ' 番目の値付近）。',
        expected: 'ストレートな引用符（"）で値全体を囲み、値の中の引用符は "" と二重にする。カンマや改行を含む値は引用符で囲む。'
      });
    });
    records.forEach(function (r) {
      for (var k = 0; k < r.fields.length; k++) {
        if (r.quoted[k]) continue;
        var f = r.fields[k];
        if (/^[“”]/.test(f) && !(f.length > 1 && /[“”]$/.test(f))) {
          for (var j = k + 1; j < r.fields.length; j++) {
            if (!r.quoted[j] && /[“”]$/.test(r.fields[j])) {
              add('C05', LEVEL.ERROR, {
                row: r.line,
                cause: '曲がり引用符（“ ”）が値の囲み記号として使われ、その中のカンマで値が分割されています（' + (k + 1) + '〜' + (j + 1) + ' 番目の値）。',
                expected: '値を囲む引用符はストレートな引用符（"）にする（例 "tag1,tag2"）。'
              });
              k = j;
              break;
            }
          }
        }
      }
    });

    // 空行の扱い
    var blankRecords = [];
    records = records.filter(function (r, idx) {
      var blank = r.fields.length === 1 && r.fields[0] === '' && !r.quoted[0];
      if (blank && idx > 0) { blankRecords.push(r.line); return false; }
      return true;
    });
    if (blankRecords.length > 0) {
      add('C06', LEVEL.WARN, {
        row: blankRecords[0],
        cause: '空行があります（' + blankRecords.map(rowLabel).join('、') + '）。空行は検査対象から除いています。',
        expected: 'レコード（商品の行）は改行で区切ります。空行の扱いは公式では確認できていないため、削除をおすすめします。'
      });
    }

    // ---- ヘッダー ------------------------------------------------------------
    if (records.length === 0 || (records[0].fields.length === 1 && records[0].fields[0] === '')) {
      // QA差し戻し F2: 本当に空のファイル（BOM を除いて0文字）と、1行目が空行のファイルで文言を分ける
      add('C07', LEVEL.ERROR, {
        row: 1,
        cause: text === ''
          ? '1行目に列ヘッダーがありません（ファイルが空です）。'
          : '1行目に列ヘッダーがありません（1行目が空行です）。2行目以降に内容があっても、列ヘッダーとしては扱わず、検査していません。',
        expected: '1行目は商品CSVの説明表・公式サンプルと同じ列ヘッダー（例 Title,URL handle,…）。'
      });
      addStanding(add, null, true);
      return finish(issues, meta);
    }

    var header = records[0].fields;
    var dataRecords = records.slice(1);
    meta.headerColumns = header.length;
    meta.dataRows = dataRecords.length;

    var colIndex = {}; // 前後空白を除いた列名 → 最初の位置
    var legacyCols = [];
    var classes = [];
    var seen = {};
    header.forEach(function (raw, idx) {
      var name = raw.replace(/^[\s﻿]+|[\s﻿]+$/g, '');
      var colNo = idx + 1;
      // C08 前後の空白
      if (name !== raw) {
        add('C08', LEVEL.ERROR, {
          row: 1,
          column: name || '(空の列名)',
          cause: colNo + ' 列目の列名 ' + quoteVal(raw) + ' の前後に余分な空白があります' + (idx === header.length - 1 ? '（1行目の末尾の空白）' : '') + '。',
          expected: '空白を含まない完全一致の列名 ' + quoteVal(name) + '。'
        });
      }
      if (seen[name]) {
        add('C07', LEVEL.WARN, {
          row: 1,
          column: name,
          cause: '同じ列名 ' + quoteVal(name) + ' が複数あります（' + seen[name] + ' 列目と ' + colNo + ' 列目）。値の検査には最初の列を使いました。',
          expected: '同じ列名の重複の扱いは公式では確認できていません。1つにまとめることをおすすめします。'
        });
      } else {
        seen[name] = colNo;
        colIndex[name] = idx;
      }
      var cls = name === '' ? { kind: 'unknown' } : classifyColumn(name);
      classes.push({ name: name, cls: cls, col: colNo });
      if (cls.kind === 'unknown') {
        add('C07', LEVEL.ERROR, {
          row: 1,
          column: name === '' ? '(空の列名)' : name,
          cause: colNo + ' 列目の列名 ' + (name === '' ? '（空）' : quoteVal(name)) + ' は、公式の説明表・公式サンプルのどの列名とも一致しません（大文字・小文字も区別します）。' + suggestColumn(name),
          expected: '公式の説明表または公式サンプルの列名と完全一致する列名（例 Title、URL handle、Price）。不要な列なら削除してください。'
        });
      } else if (cls.kind === 'spelling') {
        add('C07', LEVEL.WARN, {
          row: 1,
          column: name,
          cause: '列名 ' + quoteVal(name) + ' は公式資料に現れる列名ですが、資料間で表記が食い違っています（もう一方の表記: ' + quoteVal(cls.counterpart) + '）。',
          expected: '不適合にはしていません。ただし、現行インポートでの受理可否は公式未確認です。'
        });
      } else if (cls.kind === 'candidate') {
        add('C07', LEVEL.WARN, {
          row: 1,
          column: name,
          cause: '列名 ' + quoteVal(name) + ' は、公式に「Option LinkedTo 列群」の言及はあるものの、この綴りを公式資料から確定できない「パターン候補・未確認」の列です。値は検査していません。',
          expected: '不適合にはしていません。受理可否は公式未確認です（公式サンプルの表記は Option2 Linked To／Option3 Linked To）。'
        });
      } else if (cls.kind === 'legacy') {
        legacyCols.push(name);
        add('C09', LEVEL.WARN, {
          row: 1,
          column: name,
          cause: '列名 ' + quoteVal(name) + ' は旧形式の列名です（公式トラブルシューティングの例示に現れる形式）。',
          expected: '現行インポートでの受理可否は公式未確認です。不適合にも合格にもしていません。現行の列名（公式サンプルの1行目）への置き換えを検討してください。'
        });
      }
    });
    meta.columns = classes.map(function (c) { return { name: c.name, kind: c.cls.kind }; });

    // C10 Barcode と Barcodes の両立
    if (colIndex.hasOwnProperty('Barcode') && colIndex.hasOwnProperty('Barcodes')) {
      add('C10', LEVEL.ERROR, {
        row: 1,
        column: 'Barcode／Barcodes',
        cause: '旧単数列 Barcode と複数列 Barcodes が同じファイルに両方あります。公式説明では、両方を含めるとインポートに失敗します。',
        expected: 'どちらか一方のみ（現行の説明表は Barcodes）。'
      });
    } else if (colIndex.hasOwnProperty('Barcode') && colIndex.hasOwnProperty('Variant Barcodes')) {
      add('C10', LEVEL.WARN, {
        row: 1,
        column: 'Barcode／Variant Barcodes',
        cause: '旧単数列 Barcode と、公式サンプル表記の Variant Barcodes が両方あります。',
        expected: '公式説明で失敗すると明記されているのは Barcode と Barcodes の両立です。Variant Barcodes との組み合わせの扱いは公式未確認のため、どちらか一方にすることをおすすめします。'
      });
    }

    // ---- C06 列数 ----------------------------------------------------------
    var badCountRows = {};
    dataRecords.forEach(function (r) {
      if (r.fields.length !== header.length) {
        badCountRows[r.line] = true;
        add('C06', LEVEL.ERROR, {
          row: r.line,
          cause: 'この行の値の数が ' + r.fields.length + ' 個で、ヘッダーの列数 ' + header.length + ' と一致しません。',
          expected: '全行でヘッダーと同じ列数。カンマを含む値（Tags など）は "tag1,tag2" のように引用符で囲む。'
        });
      }
    });

    // ---- データ行0件（QA差し戻し F3。判定区分は追加せず既存の「注意」として表示） ----
    if (dataRecords.length === 0) {
      add('C11', LEVEL.WARN, {
        cause: 'データ行が0件です（列ヘッダーの行だけで、商品の行がありません）。このファイルをインポートしても商品は1件も取り込まれません。',
        expected: '2行目以降に商品の行（1商品1行）を入れてください。値の検査（C11〜C39）は、対象の行がないため実施されていません。'
      });
    }

    // ---- 旧形式ファイル（§0） ----------------------------------------------
    if (legacyCols.length > 0) {
      meta.legacyMode = true;
      add('C11', LEVEL.NA, {
        cause: '旧形式の列名（' + legacyCols.join('、') + '）を含むため、現行列を前提とする値・行構造の検査（C11〜C39）は実施していません。旧列名を現行列名へ読み替えた合格判定もしていません。',
        expected: '現行の列名（公式サンプルの1行目）に合わせたファイルで再度チェックしてください。'
      });
      addStanding(add, null, true);
      return finish(issues, meta);
    }

    // ---- 行の値の検査 --------------------------------------------------------
    function has(col) { return colIndex.hasOwnProperty(col); }
    function val(r, col) {
      if (!has(col)) return '';
      var v = r.fields[colIndex[col]];
      return v == null ? '' : v;
    }
    function tval(r, col) { return val(r, col).trim(); }

    // 列数不一致の行は値の検査をしない
    var rows = [];
    dataRecords.forEach(function (r) {
      if (badCountRows[r.line]) {
        add('C06', LEVEL.NA, {
          row: r.line,
          cause: '列数がヘッダーと一致しないため、この行の値の検査は実施していません。',
          expected: '列数を直してから再度チェックしてください。'
        });
        return;
      }
      var allEmpty = r.fields.every(function (f) { return f.trim() === ''; });
      if (allEmpty) {
        add('C11', LEVEL.WARN, {
          row: r.line,
          cause: 'すべての値が空の行です。商品データを含まない行として、検査対象から除いています。',
          expected: '不要な行であれば削除してください（商品データを含まない行は取り込まれない旨が公式エラー一覧にあります）。'
        });
        return;
      }
      rows.push(r);
    });

    // C11 Title 列
    if (!has('Title')) {
      add('C11', LEVEL.ERROR, {
        row: 1,
        column: 'Title',
        cause: 'Title 列がありません。',
        expected: '新規商品のインポートでは Title 列が必須です（必須列は Title のみ）。'
      });
    }

    // C12 URL handle 列
    if (!has('URL handle')) {
      add('C12', LEVEL.WARN, {
        column: 'URL handle',
        cause: 'URL handle 列がありません（不適合ではありません）。',
        expected: 'ハンドルは Title から自動生成されます（公式の説明。例 Title「Black Sunglasses」→ black-sunglasses）。'
      });
    }

    // C21 バリエーション検出と C13 ハンドル重複
    var groups = {};
    var groupOrder = [];
    rows.forEach(function (r) {
      var h = tval(r, 'URL handle');
      if (h === '') return;
      if (!groups[h]) { groups[h] = []; groupOrder.push(h); }
      groups[h].push(r);
    });
    var outOfScope = {};
    groupOrder.forEach(function (h) {
      var g = groups[h];
      if (g.length < 2) return;
      var allTitled = g.every(function (r) { return tval(r, 'Title') !== ''; });
      var lines = g.map(function (r) { return r.line; });
      if (allTitled) {
        add('C13', LEVEL.WARN, {
          row: lines[0],
          column: 'URL handle',
          cause: 'Title のある行同士で同じハンドル ' + quoteVal(h) + ' が使われています（' + lines.map(rowLabel).join('、') + '）。',
          expected: 'ハンドルは各商品を一意に識別します。重複した行は無視される可能性があります（公式エラー案内）。別の商品なら別のハンドルにしてください。不適合とはしていません。'
        });
      } else {
        lines.forEach(function (l) { outOfScope[l] = true; });
        add('C21', LEVEL.NA, {
          row: lines[0],
          column: 'URL handle',
          cause: '同じハンドル ' + quoteVal(h) + ' の複数行（' + lines.map(rowLabel).join('、') + '）は、バリエーションまたは複数行構造の形式です。',
          expected: '本チェッカーの対象範囲（バリエーションなし・1商品1レコード）外のため、これらの行の値は検査していません。合格ではありません。'
        });
      }
    });
    rows.forEach(function (r) {
      if (outOfScope[r.line]) return;
      var used = ['Option2 name', 'Option2 value', 'Option3 name', 'Option3 value'].filter(function (c) { return tval(r, c) !== ''; });
      if (used.length > 0) {
        outOfScope[r.line] = true;
        add('C21', LEVEL.NA, {
          row: r.line,
          column: used.join('／'),
          cause: 'Option2／Option3 が使われています（' + used.join('、') + '）。バリエーション形式を示す構造です。',
          expected: '本チェッカーの対象範囲（バリエーションなし）外のため、この行の値は検査していません。合格ではありません。'
        });
      }
    });

    var inRows = rows.filter(function (r) { return !outOfScope[r.line]; });
    meta.checkedRows = inRows.map(function (r) { return r.line; });
    meta.outOfScopeRows = rows.filter(function (r) { return outOfScope[r.line]; }).map(function (r) { return r.line; });

    // 動的列の把握
    var priceCols = PRICE_FIXED.filter(has);
    var boolCols = BOOL_FIXED.filter(has);
    var marketCols = [];
    var metafieldCols = [];
    classes.forEach(function (c) {
      if (c.cls.market && c.cls.kind === 'pattern') {
        marketCols.push(c.name);
        if (c.cls.marketPrefix === 'Included') boolCols.push(c.name);
        else priceCols.push(c.name);
      }
      if (c.cls.metafield) metafieldCols.push(c.name);
    });
    if (has('Included / International')) marketCols.unshift('Included / International');

    // C18 Fulfillment service 列省略
    if (!has('Fulfillment service')) {
      add('C18', LEVEL.WARN, {
        column: 'Fulfillment service',
        cause: 'Fulfillment service 列がありません（不適合ではありません）。',
        expected: '列を省略した場合は既定値 manual になる旨が公式の説明にあります。列を置く場合は空欄にできません。'
      });
    }
    // C20 Price 列省略
    if (!has('Price')) {
      add('C20', LEVEL.WARN, {
        column: 'Price',
        cause: 'Price 列がありません（不適合ではありません）。',
        expected: '公式の説明表では Price の既定値は 0.00 ですが、公式エラー一覧には「price can\'t be blank」もあり、発動条件は公式では確認できていません。'
      });
    }
    // C24 / §0 Status 列省略
    if (!has('Status')) {
      add('C24', LEVEL.WARN, {
        column: 'Status',
        cause: 'Status 列がありません。列がない場合、商品は自動的に active（公開状態）で登録されます（公式の説明）。',
        expected: '本チェッカーの想定用途は新規の下書き登録です。下書きにするなら Status 列を置き draft と入力してください。'
      });
    }

    inRows.forEach(function (r) {
      var L = r.line;
      var title = tval(r, 'Title');

      // C11
      if (has('Title') && title === '') {
        var h = tval(r, 'URL handle');
        add('C11', LEVEL.ERROR, {
          row: L,
          column: 'Title',
          cause: h !== ''
            ? 'ハンドル ' + quoteVal(h) + ' はありますが Title が空です。商品データを含まない行として取り込まれない旨が公式エラー一覧にあります。'
            : 'Title が空です。',
          expected: '新規商品の各行で Title を入力する（新規インポートの必須列）。'
        });
      }

      // C12 ハンドル空欄
      if (has('URL handle') && tval(r, 'URL handle') === '') {
        add('C12', LEVEL.WARN, {
          row: L,
          column: 'URL handle',
          cause: 'URL handle が空です（不適合ではありません）。',
          expected: 'ハンドルは Title から自動生成されます（公式の説明）。'
        });
      }

      // C14 / C24 Status
      if (has('Status')) {
        var st = tval(r, 'Status');
        if (st === '') {
          add('C14', LEVEL.ERROR, {
            row: L, column: 'Status',
            cause: 'Status 列がありますが、値が空です。',
            expected: 'Status 列を置く場合は値が必要です（active／draft／archived）。新規の下書き登録なら draft。'
          });
        } else {
          var sr = enumCheck(st, STATUS_KNOWN);
          if (sr === 'invalid') {
            add('C24', LEVEL.ERROR, {
              row: L, column: 'Status',
              cause: '値 ' + quoteVal(st) + ' は Status の有効値ではありません。',
              expected: 'active／draft／archived のいずれか（下書き登録なら draft）。'
            });
          } else {
            if (sr === 'case') {
              add('C24', LEVEL.WARN, {
                row: L, column: 'Status',
                cause: '値 ' + quoteVal(st) + ' は大文字を含む表記です。',
                expected: CASE_NOTE + '（説明表の表記: ' + st.toLowerCase() + '）。不適合にはしていません。'
              });
            }
            if (st.toLowerCase() !== 'draft') {
              add('C24', LEVEL.WARN, {
                row: L, column: 'Status',
                cause: '値 ' + quoteVal(st) + ' で登録されます。',
                expected: '本チェッカーの想定用途（新規の下書き登録）とは異なります。下書きにするなら draft。'
              });
            }
          }
        }
      }

      // C15 Packed product 4列
      var packedFilled = PACKED_COLUMNS.filter(function (c) { return tval(r, c) !== ''; });
      if (packedFilled.length > 0 && packedFilled.length < 4) {
        if (tval(r, 'Requires shipping').toLowerCase() !== 'false') {
          var missing = PACKED_COLUMNS.filter(function (c) { return packedFilled.indexOf(c) < 0; });
          add('C15', LEVEL.ERROR, {
            row: L, column: missing.join('／'),
            cause: 'Packed product の4列のうち一部だけに値があります（値あり: ' + packedFilled.join('、') + '／空欄または列なし: ' + missing.join('、') + '）。一部だけ値がある商品はインポートされない旨が公式にあります。',
            expected: 'Packed product length／width／height／dimension unit の4列をすべて埋めるか、すべて空欄にする（その行の Requires shipping が false の場合はこの規則は適用されません）。'
          });
        }
      }

      // C16 / C17 Inventory quantity
      var qty = tval(r, 'Inventory quantity');
      if (qty !== '' && !isNumber(qty)) {
        add('C16', LEVEL.ERROR, {
          row: L, column: 'Inventory quantity',
          cause: '値 ' + quoteVal(qty) + ' は数値ではありません（公式エラー「Inventory quantity is not a number」に対応）。',
          expected: '数値（例 10）。在庫追跡の有無にかかわらず、値を入れる場合は数値にする。'
        });
      }
      var tracker = tval(r, 'Inventory tracker');
      if (tracker !== '' && qty === '') {
        add('C17', LEVEL.ERROR, {
          row: L, column: 'Inventory quantity',
          cause: 'Inventory tracker に ' + quoteVal(tracker) + ' があり在庫を追跡する設定ですが、Inventory quantity が' + (has('Inventory quantity') ? '空です' : '列ごとありません') + '（公式エラー「Inventory quantity can\'t be blank」に対応）。',
          expected: '在庫を追跡する場合は Inventory quantity に数値を入れる。追跡しない場合は Inventory tracker を空欄にする。'
        });
      }

      // C18 Fulfillment service 空欄 / C30 形式
      var fs = val(r, 'Fulfillment service');
      var fsT = fs.trim();
      if (has('Fulfillment service')) {
        if (fsT === '') {
          add('C18', LEVEL.ERROR, {
            row: L, column: 'Fulfillment service',
            cause: 'Fulfillment service 列がありますが、値が空です（公式エラー「Fulfillment service can\'t be blank」に対応）。',
            expected: '値を入れる。フルフィルメントサービスを使わない場合は manual。'
          });
        } else {
          var fr = enumCheck(fsT, FULFILLMENT_KNOWN);
          if (fr === 'case') {
            add('C30', LEVEL.WARN, {
              row: L, column: 'Fulfillment service',
              cause: '値 ' + quoteVal(fsT) + ' は大文字を含む表記です。',
              expected: CASE_NOTE + '（説明表の表記: ' + fsT.toLowerCase() + '）。不適合にはしていません。'
            });
          } else if (fr === 'invalid') {
            if (/[A-Z]/.test(fsT) || /\s/.test(fsT)) {
              add('C30', LEVEL.ERROR, {
                row: L, column: 'Fulfillment service',
                cause: 'カスタムサービス名 ' + quoteVal(fsT) + ' に' + [/[A-Z]/.test(fsT) ? '大文字' : null, /\s/.test(fsT) ? 'スペース' : null].filter(Boolean).join('と') + 'が含まれています。',
                expected: '公式の形成規則: カスタムサービス名は小文字のみ、スペースはダッシュに置き換える（例 "Joan\'s Fulfillment" → joans-fulfillment）。既知の値は manual／shipwire／webgistix／amazon_marketplace_web。'
              });
            } else {
              add('C30', LEVEL.NA, {
                row: L, column: 'Fulfillment service',
                cause: 'カスタムサービス名 ' + quoteVal(fsT) + ' がストアに登録済みかどうかは、CSVからは確認できません。',
                expected: 'カスタムサービスは事前に管理画面で設定が必要です（公式の説明）。ストア登録との一致は未検査です。'
              });
            }
          }
        }
      }

      // C19 SKU 条件付き
      if (fsT !== '' && fsT.toLowerCase() !== 'manual' && tval(r, 'SKU') === '') {
        add('C19', LEVEL.WARN, {
          row: L, column: 'SKU',
          cause: 'Fulfillment service が ' + quoteVal(fsT) + '（manual 以外）で、SKU が' + (has('SKU') ? '空です' : '列ごとありません') + '。',
          expected: 'カスタムフルフィルメントサービスを使う場合は SKU を空欄にできません（公式の説明）。カスタムサービスかどうかはCSVだけでは確定できないため、注意に留めています。'
        });
      }

      // C20 Price 空欄
      if (has('Price') && tval(r, 'Price') === '') {
        add('C20', LEVEL.WARN, {
          row: L, column: 'Price',
          cause: 'Price が空です（不適合ではありません）。',
          expected: '公式の説明表では既定値 0.00 ですが、公式エラー一覧には「price can\'t be blank」があり、どの条件でエラーになるかは公式では確認できていません。価格を入れることをおすすめします。'
        });
      }

      // C22 金額
      priceCols.forEach(function (c) {
        var v = tval(r, c);
        if (v === '') return;
        if (!isNumber(v)) {
          add('C22', LEVEL.ERROR, {
            row: L, column: c,
            cause: '値 ' + quoteVal(v) + ' は' + (CURRENCY_RE.test(v) ? '通貨記号・通貨名を含んでいます' : '金額の数値ではありません') + '。',
            expected: '通貨記号なしの金額のみ（例 9.99）。'
          });
        }
      });

      // C23 真偽値 / C38 ギフトカード
      boolCols.forEach(function (c) {
        var v = tval(r, c);
        if (v === '') return;
        var b = enumCheck(v, ['true', 'false']);
        if (b === 'invalid') {
          add('C23', LEVEL.ERROR, {
            row: L, column: c,
            cause: '値 ' + quoteVal(v) + ' は真偽値の有効値ではありません。',
            expected: 'true または false。'
          });
        } else if (b === 'case') {
          add('C23', LEVEL.WARN, {
            row: L, column: c,
            cause: '値 ' + quoteVal(v) + ' は大文字を含む表記です。',
            expected: CASE_NOTE + '（説明表の表記: ' + v.toLowerCase() + '）。不適合にはしていません。'
          });
        }
      });
      if (tval(r, 'Gift card').toLowerCase() === 'true') {
        add('C38', LEVEL.ERROR, {
          row: L, column: 'Gift card',
          cause: 'Gift card が ' + quoteVal(tval(r, 'Gift card')) + ' です。ギフトカードはCSVインポートでは新規作成できません（管理画面でのみ作成・有効化できる旨が公式にあります）。値 true 自体は真偽値として有効な形式です（C23 とは別の判定です）。',
          expected: '新規ギフトカードのCSV作成は不可。通常の商品として登録するなら false。ギフトカードは管理画面で作成してください。'
        });
      }

      // C25 Inventory tracker
      if (tracker !== '') {
        var tr = enumCheck(tracker, TRACKER_KNOWN);
        if (tr === 'invalid') {
          add('C25', LEVEL.ERROR, {
            row: L, column: 'Inventory tracker',
            cause: '値 ' + quoteVal(tracker) + ' は Inventory tracker の有効値ではありません。',
            expected: 'shopify／shipwire／amazon_marketplace_web、または空欄（在庫を追跡しない）。'
          });
        } else if (tr === 'case') {
          add('C25', LEVEL.WARN, {
            row: L, column: 'Inventory tracker',
            cause: '値 ' + quoteVal(tracker) + ' は大文字を含む表記です。',
            expected: CASE_NOTE + '（説明表の表記: ' + tracker.toLowerCase() + '）。不適合にはしていません。'
          });
        }
      }

      // C26 Continue selling when out of stock
      var pol = tval(r, 'Continue selling when out of stock');
      if (pol !== '') {
        var pr = enumCheck(pol, POLICY_KNOWN);
        if (pr === 'invalid') {
          add('C26', LEVEL.ERROR, {
            row: L, column: 'Continue selling when out of stock',
            cause: '値 ' + quoteVal(pol) + ' は有効値ではありません（公式エラー「Inventory policy is not included in the list」に対応）。',
            expected: 'deny（在庫0で購入不可）または continue（購入可）。'
          });
        } else if (pr === 'case') {
          add('C26', LEVEL.WARN, {
            row: L, column: 'Continue selling when out of stock',
            cause: '値 ' + quoteVal(pol) + ' は大文字を含む表記です。',
            expected: CASE_NOTE + '（説明表の表記: ' + pol.toLowerCase() + '）。不適合にはしていません。'
          });
        }
      }

      // C27 Weight value (grams)
      var w = tval(r, 'Weight value (grams)');
      if (w !== '' && !/^\d+$/.test(w)) {
        add('C27', LEVEL.ERROR, {
          row: L, column: 'Weight value (grams)',
          cause: '値 ' + quoteVal(w) + ' は' + (/^\d+\.\d+$/.test(w) ? '小数点を含んでいます' : (/\d/.test(w) ? '単位などの数字以外の文字を含んでいます' : '数値ではありません')) + '。',
          expected: 'グラム単位の数値のみ。単位や小数点は付けない（例 5.125 kg → 5125）。'
        });
      }

      // C28 / C29 単位（大文字・小文字差は注意。U7）
      [['Weight unit for display', WEIGHT_UNITS, 'C28'], ['Packed product dimension unit', DIM_UNITS, 'C29']].forEach(function (spec) {
        var v = tval(r, spec[0]);
        if (v === '') return;
        var e = enumCheck(v, spec[1]);
        if (e === 'invalid') {
          add(spec[2], LEVEL.ERROR, {
            row: L, column: spec[0],
            cause: '値 ' + quoteVal(v) + ' は有効値ではありません。',
            expected: spec[1].join('／') + ' のいずれか。'
          });
        } else if (e === 'case') {
          add(spec[2], LEVEL.WARN, {
            row: L, column: spec[0],
            cause: '値 ' + quoteVal(v) + ' は大文字を含む表記です。',
            expected: CASE_NOTE + '（説明表の表記: ' + v.toLowerCase() + '）。不適合にはしていません。'
          });
        }
      });

      // C31 URL handle 形式
      var handleRaw = val(r, 'URL handle');
      // QA差し戻し F1: 全角スペース（U+3000）が C31 の「スペース」に含まれるかは仕様未確定（U9）のため
      // 不適合にせず注意とする（review.md の解釈ピン）。それ以外の空白文字の扱いは従来どおり不適合。
      var handleT = handleRaw.trim();
      if (handleT !== '' && /[^\S　]/.test(handleT)) {
        add('C31', LEVEL.ERROR, {
          row: L, column: 'URL handle',
          cause: 'ハンドル ' + quoteVal(handleT) + ' にスペースが含まれています。',
          expected: 'ハンドルにはスペースを含められません。文字・ダッシュ・数字は使えます（例 black-sunglasses）。'
        });
      }
      if (handleT.indexOf('　') >= 0) {
        add('C31', LEVEL.WARN, {
          row: L, column: 'URL handle',
          cause: 'ハンドル ' + quoteVal(handleT) + ' に全角スペースが含まれています。',
          expected: '全角スペースが「スペースを含められない」の対象になるかは公式未確認のため、不適合にはしていません。半角ダッシュ等への置き換えをおすすめします（例 black-sunglasses）。'
        });
      }

      // C32 Tags
      var tagsRaw = val(r, 'Tags');
      if (tagsRaw.trim() !== '') {
        var tags = tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
        if (tags.length > 250) {
          add('C32', LEVEL.ERROR, {
            row: L, column: 'Tags',
            cause: 'タグが ' + tags.length + ' 個あり、上限の 250 個を超えています。',
            expected: '1商品あたり最大 250 タグ（カンマ区切り）。'
          });
        }
        var accented = [];
        var symbols = [];
        tags.forEach(function (t) {
          var nfd = t.normalize ? t.normalize('NFD') : t;
          if (/[̀-ͯ]/.test(nfd)) accented.push(t);
          else if (/[^\p{L}\p{N}\- ]/u.test(t)) symbols.push(t);
        });
        if (accented.length || symbols.length) {
          var parts = [];
          if (accented.length) parts.push('アクセント付き文字を含むタグ: ' + accented.slice(0, 5).map(quoteVal).join('、'));
          if (symbols.length) parts.push('記号を含むタグ: ' + symbols.slice(0, 5).map(quoteVal).join('、'));
          add('C32', LEVEL.WARN, {
            row: L, column: 'Tags',
            cause: parts.join('／') + '。',
            expected: '公式の案内は「文字・数字・ハイフンを使い、アクセント付き文字と記号は避ける」です。不適合にはしていません。'
          });
        }
      }

      // C33 Collection
      var coll = val(r, 'Collection');
      if (charLength(coll) > 255) {
        add('C33', LEVEL.ERROR, {
          row: L, column: 'Collection',
          cause: 'コレクション名が ' + charLength(coll) + ' 文字で、255 文字を超えています（公式エラー「Collection title cannot be longer than 255 characters」に対応）。',
          expected: '最大 255 文字。'
        });
      }

      // C34 Product image URL
      var img = tval(r, 'Product image URL');
      if (img !== '') {
        if (!/^https:\/\//i.test(img)) {
          add('C34', LEVEL.ERROR, {
            row: L, column: 'Product image URL',
            cause: '画像URL ' + quoteVal(img) + ' が https:// で始まっていません。',
            expected: 'https:// で始まる、公開アクセス可能な（パスワード保護のない）URL。'
          });
        }
        var path = img.replace(/[?#].*$/, '');
        var fileName = path.substring(path.lastIndexOf('/') + 1);
        var stem = fileName.replace(/\.[^.]*$/, '');
        var sfx = /_(thumb|small|medium)$/i.exec(stem);
        if (sfx) {
          add('C34', LEVEL.ERROR, {
            row: L, column: 'Product image URL',
            cause: '画像のファイル名 ' + quoteVal(fileName) + ' に接尾辞 ' + quoteVal(sfx[0]) + ' が含まれています。',
            expected: 'ファイル名に _thumb／_small／_medium の接尾辞を含めない（アップロード後はファイル名を編集できません）。'
          });
        }
      }

      // C35 Image position
      var pos = tval(r, 'Image position');
      if (pos !== '') {
        if (!isNumber(pos)) {
          add('C35', LEVEL.ERROR, {
            row: L, column: 'Image position',
            cause: '値 ' + quoteVal(pos) + ' は数ではありません。',
            expected: '表示順を表す 1 以上の数（例 1）。'
          });
        } else if (parseFloat(pos) < 1) {
          add('C35', LEVEL.ERROR, {
            row: L, column: 'Image position',
            cause: '値 ' + quoteVal(pos) + ' は 1 未満です。',
            expected: '表示順を表す 1 以上の数（表示順は 1 から始まります）。'
          });
        }
      }

      // C36 Image alt text
      var alt = val(r, 'Image alt text');
      if (charLength(alt) > 512) {
        add('C36', LEVEL.ERROR, {
          row: L, column: 'Image alt text',
          cause: '代替テキストが ' + charLength(alt) + ' 文字で、512 文字を超えています。',
          expected: '最大 512 文字（公式の目安では 125 文字以下が最適）。'
        });
      }

      // C37 SEO
      var seoT = val(r, 'SEO title');
      if (charLength(seoT) > 70) {
        add('C37', LEVEL.ERROR, {
          row: L, column: 'SEO title',
          cause: 'SEO title が ' + charLength(seoT) + ' 文字で、70 文字を超えています。',
          expected: '最大 70 文字（空欄なら Title が使われます）。'
        });
      }
      var seoD = val(r, 'SEO description');
      if (charLength(seoD) > 320) {
        add('C37', LEVEL.ERROR, {
          row: L, column: 'SEO description',
          cause: 'SEO description が ' + charLength(seoD) + ' 文字で、320 文字を超えています。',
          expected: '最大 320 文字（空欄なら Description が使われます）。'
        });
      }

      // C39 Barcodes
      var bc = val(r, 'Barcodes');
      if (bc.trim() !== '') {
        var items = bc.split(';').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
        if (items.length > 20) {
          add('C39', LEVEL.ERROR, {
            row: L, column: 'Barcodes',
            cause: 'バーコードが ' + items.length + ' 個あり、上限の 20 個を超えています。',
            expected: 'セミコロン区切りで最大 20 個。'
          });
        }
        var badTyped = items.filter(function (x) {
          var p = x.indexOf(':');
          if (p < 0) return false;
          return x.slice(0, p).trim() === '' || x.slice(p + 1).trim() === '';
        });
        if (badTyped.length) {
          add('C39', LEVEL.ERROR, {
            row: L, column: 'Barcodes',
            cause: '「型:値」の形になっていない要素があります: ' + badTyped.slice(0, 5).map(quoteVal).join('、') + '。',
            expected: '型を付ける場合は「型:値」形式（コロンの前後に文字列。例 gtin:00012345678905）。複数はセミコロン区切り。'
          });
        }
      }
    });

    // ---- 列単位の対象外・未検査（値がある場合） --------------------------------
    function rowsWithValue(col) {
      return inRows.filter(function (r) { return tval(r, col) !== ''; }).map(function (r) { return r.line; });
    }
    function naColumn(id, col, cause, expected) {
      var ls = rowsWithValue(col);
      if (!has(col) || ls.length === 0) return;
      add(id, LEVEL.NA, {
        row: ls[0], column: col,
        cause: cause + '（値のある行: ' + ls.slice(0, 10).map(rowLabel).join('、') + (ls.length > 10 ? ' ほか' : '') + '）。',
        expected: expected
      });
    }
    naColumn('C39', 'Variant Barcodes', 'Variant Barcodes 列の値は検査していません。Barcodes 列の規則（最大20個・型:値形式）を Variant Barcodes 表記の列に適用できるかは公式未確認です',
      '対象外・未検査。合格ではありません。');
    naColumn('C34', 'Product image URL', '画像URLが実際に公開アクセス可能か（到達性）は検査していません',
      '対象外・未検査。URLの形式（https://、接尾辞）のみ検査しています。');
    naColumn('C40', 'Product category', 'Product category が Standard Product Taxonomy に一致するかは検査していません',
      '対象外・未検査。一致しない場合は「Not a valid product category」エラーになる旨が公式にありますが、本チェッカーはタクソノミー全体を保持していません。合格ではありません。');
    GOOGLE_CATEGORY_COLUMNS.forEach(function (c) {
      naColumn('C41', c, c + ' の妥当性は検査していません', '対象外・未検査。合格ではありません。');
    });
    metafieldCols.forEach(function (c) {
      naColumn('C42', c, 'メタフィールド列 ' + quoteVal(c) + ' の値の型は検査していません（定義はストアごとでCSV単体では確定できません）', '対象外・未検査。合格ではありません。');
    });
    TAX_UNIT_COLUMNS.forEach(function (c) {
      naColumn('C43', c, c + ' の値は検査していません（意味・型・必須条件が公式未確認）', '対象外・未検査。列があること自体は不適合にしていません。合格ではありません。');
    });
    marketCols.forEach(function (c) {
      if (!has(c)) return;
      add('C44', LEVEL.NA, {
        row: 1, column: c,
        cause: '市場別の列 ' + quoteVal(c) + ' の市場名がストアの設定と一致するかは、CSVからは確認できません。',
        expected: '対象外・未検査。値の形式（金額・真偽値）は C22／C23 で検査しています。'
      });
    });

    addStanding(add, has, false);
    return finish(issues, meta);
  }

  // C04 改行形式（参考情報）
  function addLineEndingInfo(add, le) {
    var kinds = [];
    if (le.crlf) kinds.push('CRLF ' + le.crlf + ' 箇所');
    if (le.lf) kinds.push('LF ' + le.lf + ' 箇所');
    if (le.cr) kinds.push('CR ' + le.cr + ' 箇所');
    add('C04', LEVEL.NA, {
      cause: '改行形式（参考情報）: ' + (kinds.length ? kinds.join('、') : '改行なし') + '。',
      expected: '改行形式は判定に使っていません（対象外・未検査）。公式本文は LF 形式での保存を案内していますが、公式サンプルの実ファイルは CRLF です。'
    });
  }

  // 常に表示する未検査事項（検査範囲の明示）
  function addStanding(add, has, early) {
    if (!early) {
      add('C13', LEVEL.NA, {
        column: 'URL handle',
        cause: 'ストアに既にある商品のハンドルとの重複は、CSV単体では確認できないため検査していません。',
        expected: '対象外・未検査。既存のハンドルと重複する行は無視される旨が公式エラー案内にあります。'
      });
      add('C17', LEVEL.NA, {
        column: 'Inventory quantity',
        cause: 'Inventory quantity の数量が適用されるのは単一ロケーションのストアのみという公式条件があります。複数ロケーションのストアでの扱いは確認できません。',
        expected: '対象外・未検査（ストアのロケーション構成はCSVから分かりません）。'
      });
      add('C31', LEVEL.NA, {
        column: 'URL handle',
        cause: 'ハンドルの文字種は一部未検査です。スペースのみ検査しており、日本語・アクセント付き文字・ピリオド・アンダースコア等の可否は公式未確認のため検査していません。',
        expected: '対象外・未検査。'
      });
    }
    add('C40', LEVEL.NA, { column: 'Product category', cause: 'Product category の妥当性（Standard Product Taxonomy への一致）は検査していません。', expected: '対象外・未検査。合格ではありません。' });
    add('C41', LEVEL.NA, { column: 'Google Shopping / Google Product Category', cause: 'Google Shopping / Google Product Category の妥当性は検査していません。', expected: '対象外・未検査。合格ではありません。' });
    add('C42', LEVEL.NA, { column: 'Metafields', cause: 'メタフィールド列の値の型の妥当性は検査していません。', expected: '対象外・未検査。合格ではありません。' });
    add('C43', LEVEL.NA, { column: 'Tax code／Unit price 系', cause: 'Tax code／Unit price total measure／Unit price total measure unit／Unit price base measure／Unit price base measure unit の値は検査していません（意味・型・必須条件が公式未確認）。', expected: '対象外・未検査。合格ではありません。' });
    add('C44', LEVEL.NA, { column: 'Included／Price／Compare At Price / [市場名]', cause: '市場別列の市場名の妥当性は、ストア設定に依存するため検査していません。', expected: '対象外・未検査。合格ではありません。' });
    add('C45', LEVEL.NA, { column: 'Description／Vendor／Type 等', cause: '公式に形式の定めがない自由記述列（Description／Vendor／Type 等）の内容は検査していません。', expected: '対象外・未検査（列名のみ検査）。' });
    add('C46', LEVEL.NA, { cause: '行数上限等は未検査です。15 MB 以外のファイル上限（行数上限、バリエーション数上限など）は公式で確認できていないため検査していません。', expected: '対象外・未検査。' });
    add('C47', LEVEL.NA, { cause: '商品の更新（上書き）用途の条件（更新時の必須列 URL handle、Option1 name／Option1 value の同時指定など）は検査していません。本チェッカーは新規登録専用です。', expected: '対象外・未検査。' });
    add('C48', LEVEL.NA, { column: 'Product image URL', cause: '1商品あたり画像250枚の上限は検査していません（複数画像は複数行構造になり、本チェッカーの対象外の形式と一体のため）。', expected: '対象外・未検査。' });
  }

  function suggestColumn(name) {
    if (!name) return '';
    var lower = name.toLowerCase();
    var all = S5_HEADER.concat(S1_EXTRA);
    for (var i = 0; i < all.length; i++) {
      if (all[i].toLowerCase() === lower) return '（大文字・小文字の違う列名 ' + '「' + all[i] + '」があります）';
    }
    for (var j = 0; j < LEGACY_COLUMNS.length; j++) {
      if (LEGACY_COLUMNS[j].toLowerCase() === lower) return '（旧形式の列名「' + LEGACY_COLUMNS[j] + '」と大文字・小文字だけが違います）';
    }
    return '';
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === 'string') {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
    }
    if (input && input.buffer && typeof input.byteLength === 'number') {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    throw new Error('check(): 入力は Uint8Array／ArrayBuffer／文字列で渡してください');
  }

  var LEVEL_ORDER = {};
  LEVEL_ORDER[LEVEL.ERROR] = 0;
  LEVEL_ORDER[LEVEL.WARN] = 1;
  LEVEL_ORDER[LEVEL.NA] = 2;

  function finish(issues, meta) {
    var counts = {};
    counts[LEVEL.ERROR] = 0;
    counts[LEVEL.WARN] = 0;
    counts[LEVEL.NA] = 0;
    issues.forEach(function (x) { counts[x.level]++; });
    var verdict;
    if (counts[LEVEL.ERROR] > 0) {
      verdict = '仕様不適合が ' + counts[LEVEL.ERROR] + ' 件あります。下の一覧の物理行・列名・原因・期待形式を確認して修正してください。';
    } else {
      verdict = '検査した範囲では仕様不適合は見つかりませんでした。これは合格判定ではなく、インポートの成功を保証するものでもありません。注意（' +
        counts[LEVEL.WARN] + ' 件）と対象外・未検査（' + counts[LEVEL.NA] + ' 件）の項目も確認してください。';
    }
    var sorted = issues.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      var d = LEVEL_ORDER[a.x.level] - LEVEL_ORDER[b.x.level];
      if (d) return d;
      return a.i - b.i;
    }).map(function (o) { return o.x; });
    return { issues: sorted, counts: counts, verdict: verdict, meta: meta };
  }

  return {
    version: '1.0.0',
    LEVEL: LEVEL,
    SCOPE_LINE: SCOPE_LINE,
    check: check,
    classifyColumn: classifyColumn,
    parseCsv: parseCsv,
    findInvalidUtf8: findInvalidUtf8,
    LIMIT_BYTES_BINARY: LIMIT_BYTES_BINARY,
    LIMIT_BYTES_DECIMAL: LIMIT_BYTES_DECIMAL
  };
});
