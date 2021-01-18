import * as fs from '../utils/fs'
import * as pathUtils from 'path'

const TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Intentionally lax Network Security Configuration (generated by apk-mitm) -->
<network-security-config>
  <!-- Allow cleartext traffic -->
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <!-- Allow user-added (proxy) certificates -->
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>`

export default async function createNetworkSecurityConfig(path: string) {
  await fs.mkdir(pathUtils.dirname(path), { recursive: true })
  await fs.writeFile(path, TEMPLATE, 'utf-8')
}
