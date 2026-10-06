# devpi202610 — 介護施設 送迎管理システム

デイサービス等の送迎（迎え・送り）を管理する Web アプリ。利用者 30 人・車両 10 台程度を想定。

- **利用者一覧**: 管理番号・名前・ADL・車椅子・住所（位置）・利用曜日
- **車両一覧**: 車種・乗れる人数・車椅子数・車の大きさ
- **運転者一覧**: 名前・運転できる車の種類（車の大きさ）
- **運行ルート記録表**: その日の迎え/送りのルートを自動生成 → 手動調整 → 実績記録 → 印刷

すべて Web 画面から登録・編集・削除できる（ログインなし。LAN 内での利用を前提）。

## 構成

| | |
|---|---|
| `server/` | Node.js 24 + TypeScript（型除去でそのまま実行）+ Express 5 + mysql2 + zod |
| `web/` | React 19 + Vite + TypeScript、地図は Leaflet + 国土地理院タイル |
| `db/schema.sql` | MariaDB スキーマ |
| `deploy/` | systemd ユーザーサービス、Apache リバースプロキシ設定 |

## ルート自動生成の考え方（`server/src/routing.ts`）

1. 運転者と車両の組み合わせ: 運転者が運転できる区分の車両だけを対象に二部マッチング（大きい車を優先）
2. 利用者の割り当て: 車椅子の方 → 施設から遠い方の順に、定員・車椅子枠を守りつつ「距離の増加が最小」の車へ挿入
3. 乗車順: 2-opt で巡回距離を短縮。迎えは最後が施設に近い人、送りは最初が施設に近い人になる向き
4. 予定時刻: 迎えは「施設到着目標」から逆算、送りは「施設出発時刻」から積み上げ（距離は直線 × 1.3 で近似）

位置情報のない利用者、定員・車椅子枠が足りない利用者は理由付きで「未割当」に残る。

## 開発

```sh
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm run db:schema               # スキーマ作成（初回）
npm run seed:sample -w server   # 架空のサンプルデータ（利用者 0 件のときだけ）
npm run dev                     # API :3000 + Vite :5173
npm test                        # ルート生成ロジックのテスト
npm run typecheck
```

DB 接続情報はリポジトリ直下の `.env`（Git 管理外）:

```
DB_HOST=localhost
DB_NAME=devpi
DB_USER=devpi
DB_PASS=...
PORT=3000
```

## 本番（Raspberry Pi）

```sh
npm run build                                   # web/dist を作成（Express が配信）
systemctl --user restart sogei                  # deploy/sogei.service
journalctl --user -u sogei -f                   # ログ
```

Apache から 80 番で公開する場合は `deploy/apache-sogei.conf` の手順を参照。

## 注意

- 住所から位置への変換で、**住所の文字列だけ**を国土地理院の住所検索 API に送る（氏名などは送らない）。
- ログイン機能はないので、インターネットには公開しないこと。
