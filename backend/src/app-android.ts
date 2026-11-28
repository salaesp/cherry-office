// La app de Android (android/) abre la oficina en Chrome como Trusted Web Activity. Para que Chrome la muestre sin
// barra de direcciones y le pase los avisos a la app, el sitio declara en /.well-known/assetlinks.json que confía en
// ella (Digital Asset Links). La huella es la de android/app/debug.keystore, la clave fija con la que se firma el APK.
export const paqueteAndroid = 'app.oficina.android'
export const huellaAndroid = '09:AA:40:21:35:4E:5A:B2:FC:7C:E8:71:99:99:3A:B5:BA:C3:D1:55:0A:59:98:D3:01:33:98:FA:1B:60:E7:2B'

export function assetLinks() {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: paqueteAndroid, sha256_cert_fingerprints: [huellaAndroid] },
  }]
}
