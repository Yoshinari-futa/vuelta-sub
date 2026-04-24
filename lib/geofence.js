/**
 * VUELTA ジオフェンス定義（全経路で共通利用）
 *
 * 座標・文言は env で上書き可能:
 *   VUELTA_GEOFENCE_LAT
 *   VUELTA_GEOFENCE_LNG
 *   VUELTA_GEOFENCE_TEXT
 */

const DEFAULT_LAT = 34.3893066;
const DEFAULT_LNG = 132.4541823;
const DEFAULT_RELEVANT_TEXT = "You're near VUELTA. How about a drink tonight?";
const DEFAULT_RADIUS = 300;

function getGeofenceLocation() {
  return {
    latitude: parseFloat(process.env.VUELTA_GEOFENCE_LAT || '') || DEFAULT_LAT,
    longitude: parseFloat(process.env.VUELTA_GEOFENCE_LNG || '') || DEFAULT_LNG,
    relevantText: (process.env.VUELTA_GEOFENCE_TEXT || DEFAULT_RELEVANT_TEXT).trim(),
    altitude: 0,
    radius: DEFAULT_RADIUS,
  };
}

function getGeofenceLocations() {
  return [getGeofenceLocation()];
}

module.exports = {
  getGeofenceLocation,
  getGeofenceLocations,
};
