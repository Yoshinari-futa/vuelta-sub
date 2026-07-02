/**
 * VUELTA ジオフェンス定義（全経路で共通利用）
 *
 * 会員パス(Apple Wallet)に複数地点を登録し、地点ごとに別の文言を出す。
 * Apple Wallet は近づいた地点のうち「最も近い1地点」をロック画面に表示するため、
 * 地点同士が重ならないよう半径(maxDistance)を絞ってある(広島中心部は密集地)。
 *
 * 地点(2026-07-01 時点、地元常連中心の動線で設計):
 *   1. 店前・中電前(コア)   150m  「今夜の一杯、VUELTAで待ってます」
 *   2. 原爆ドーム            300m  「歩き疲れたら、VUELTAでひと休みを」
 *   3. 並木通り              300m  「二軒目は、VUELTAでゆっくりどうぞ」
 *
 * 店前(コア)だけ env で上書き可能:
 *   VUELTA_GEOFENCE_LAT     (default: 34.3893066)
 *   VUELTA_GEOFENCE_LNG     (default: 132.4541823)
 *   VUELTA_GEOFENCE_TEXT    (default: "今夜の一杯、VUELTAで待ってます")
 *   VUELTA_GEOFENCE_RADIUS  (default: 150 メートル)
 * 追加地点(原爆ドーム/並木通り)はコード定義。
 *
 * フィールド名の注意:
 *   PassKit の REST API は Apple Wallet の PKLocation 仕様 (latitude / longitude /
 *   relevantText / altitude / maxDistance) ではなく、短縮形の `lat` / `lon` /
 *   `lockScreenMessage` / `alt` / `maxDistance` で保存する。
 *   ウチの過去コードは長い名前で送っていたため、PassKit 側で全フィールドが
 *   0 / 空文字で保存されてジオフェンスが実質効いていなかった。
 *   このヘルパーは PassKit の保存形式に合わせた短縮名で返す。
 */

const DEFAULT_LAT = 34.3893066;
const DEFAULT_LNG = 132.4541823;
const DEFAULT_RELEVANT_TEXT = "今夜の一杯、VUELTAで待ってます";
const DEFAULT_RADIUS = 150;  // メートル(店前。密集地のため絞る)

// 店前・中電前(コア)。env で座標・文言・半径を上書き可能。
function getPrimaryLocation() {
  const lat = parseFloat(process.env.VUELTA_GEOFENCE_LAT || '') || DEFAULT_LAT;
  const lon = parseFloat(process.env.VUELTA_GEOFENCE_LNG || '') || DEFAULT_LNG;
  const msg = (process.env.VUELTA_GEOFENCE_TEXT || DEFAULT_RELEVANT_TEXT).trim();
  const radius = parseInt(process.env.VUELTA_GEOFENCE_RADIUS || '', 10) || DEFAULT_RADIUS;
  return {
    lat,
    lon,
    alt: 0,
    lockScreenMessage: msg,
    maxDistance: radius,
  };
}

// 追加地点(文脈別)。地元常連の市内動線 + 観光動線。座標は 2026-07-01 に地図で確認済み。
const EXTRA_LOCATIONS = [
  {
    lat: 34.3955,
    lon: 132.4536,
    alt: 0,
    lockScreenMessage: "歩き疲れたら、VUELTAでひと休みを",
    maxDistance: 300,
  },
  {
    lat: 34.38969,
    lon: 132.46079,
    alt: 0,
    lockScreenMessage: "二軒目は、VUELTAでゆっくりどうぞ",
    maxDistance: 300,
  },
];

// 後方互換: 単数を期待する既存呼び出し用(店前を返す)
function getGeofenceLocation() {
  return getPrimaryLocation();
}

// 全経路の本線。店前(コア) + 追加地点をまとめて返す。
function getGeofenceLocations() {
  return [getPrimaryLocation(), ...EXTRA_LOCATIONS];
}

module.exports = {
  getGeofenceLocation,
  getGeofenceLocations,
};
