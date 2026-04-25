/**
 * VUELTA ジオフェンス定義（全経路で共通利用）
 *
 * 座標・文言・半径は env で上書き可能:
 *   VUELTA_GEOFENCE_LAT     (default: 34.3893066)
 *   VUELTA_GEOFENCE_LNG     (default: 132.4541823)
 *   VUELTA_GEOFENCE_TEXT    (default: "You're near VUELTA. How about a drink tonight?")
 *   VUELTA_GEOFENCE_RADIUS  (default: 500 メートル)
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
const DEFAULT_RELEVANT_TEXT = "You're near VUELTA. How about a drink tonight?";
const DEFAULT_RADIUS = 500;  // メートル

function getGeofenceLocation() {
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

function getGeofenceLocations() {
  return [getGeofenceLocation()];
}

module.exports = {
  getGeofenceLocation,
  getGeofenceLocations,
};
