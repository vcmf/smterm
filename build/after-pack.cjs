// Ad-hoc sign the whole macOS bundle (free, no Apple account). electron-builder
// with identity:null skips signing, which leaves only the linker's ad-hoc sig on the
// inner binary — the outer .app bundle stays unsealed and can fail to launch when
// distributed. A deep ad-hoc codesign seals the bundle + nested helpers/frameworks so
// it runs on Apple Silicon via a curl/brew/scoop install (which isn't Gatekeeper-
// quarantined). Notarized Developer-ID signing is v0.1 (M4).
const { execFileSync } = require("node:child_process")
const path = require("node:path")

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })
  console.log(`  • ad-hoc signed ${path.basename(app)}`)
}
