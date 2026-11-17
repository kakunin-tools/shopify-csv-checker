# Shopify商品CSV 事前チェッカー

Shopify に商品CSVをインポートする**前に**、ファイルの形式上の問題をブラウザだけでチェックできる無料ツールです。

**▶ 使ってみる: https://kakunin-tools.github.io/shopify-csv-checker/**

## 特徴

- CSVファイルはブラウザの中だけで処理します。ファイルの内容がサーバーへ送信されることはありません
- Shopify 公式ドキュメントの仕様に基づいて、列ヘッダー、必須項目、値の形式などを診断します
- 結果は「仕様不適合」「注意」「対象外・未検査」に分けて表示します。仕様で確認できない項目は、合格とは表示しません

## 解説記事

- [ShopifyのCSVが文字化けする原因と直し方](https://kakunin-tools.github.io/shopify-csv-checker/articles/mojibake.html)
- [Shopify CSVのヘッダーエラーを防ぐには](https://kakunin-tools.github.io/shopify-csv-checker/articles/invalid-csv-header.html)
- [Shopifyに商品CSVを取り込む前のチェックリスト](https://kakunin-tools.github.io/shopify-csv-checker/articles/pre-import-checklist.html)

## 注意事項

- 本ツールは Shopify の公式ツールではありません（Shopify Inc. とは関係のない個人プロジェクトです）
- 本ツールは「仕様ベースの事前チェック」です。実際のインポート結果を保証するものではありません
- チェックできるのは公式ドキュメントで確認できる形式仕様の範囲です。ストア固有の設定や在庫・画像ファイルの実在などは対象外です
