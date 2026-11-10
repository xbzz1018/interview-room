import { chmod, cp, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const targetPlatform = argument('platform') || process.platform
const targetArch = argument('arch') || process.arch
const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])
const supportedArchitectures = new Set(['arm64', 'x64'])
if (!supportedPlatforms.has(targetPlatform) || !supportedArchitectures.has(targetArch)) {
  throw new Error(`Unsupported desktop backend target: ${targetPlatform}-${targetArch}`)
}
const bunPlatform = targetPlatform === 'win32' ? 'windows' : targetPlatform
const compileTarget = `bun-${bunPlatform}-${targetArch}` as Bun.Build.CompileTarget
const executableName = targetPlatform === 'win32' ? 'techspar-api.exe' : 'techspar-api'
const output = join(root, 'apps', 'desktop', 'resources', 'backend', executableName)
const runtimeOutput = join(dirname(output), 'onnxruntime')
const buildScratchPattern = /^\.[a-f0-9]+-\d+\.bun-build$/

await rm(dirname(output), { recursive: true, force: true })
await mkdir(dirname(output), { recursive: true })
const sharpStub = resolve(root, 'scripts', 'desktop-sharp-stub.ts')
const filesBeforeBuild = new Set(await readdir(root))
let build: Awaited<ReturnType<typeof Bun.build>>
try {
  build = await Bun.build({
    entrypoints: [resolve(root, 'apps', 'api', 'src', 'entry.bun.ts')],
    packages: 'bundle',
    external: ['pdfjs-dist', '@huggingface/transformers'],
    compile: {
      target: compileTarget,
      outfile: output,
      autoloadDotenv: false,
      autoloadPackageJson: true,
      autoloadTsconfig: true,
      autoloadBunfig: true,
      ...(targetPlatform === 'win32' ? { windows: { hideConsole: true } } : {}),
    },
    plugins: [{
      name: 'techspar-text-only-transformers',
      setup(builder) {
        builder.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpStub }))
      },
    }],
  })
} finally {
  const scratchFiles = (await readdir(root)).filter((name) =>
    !filesBeforeBuild.has(name) && buildScratchPattern.test(name))
  await Promise.all(scratchFiles.map((name) => rm(join(root, name), { force: true })))
}
if (!build.success) {
  for (const message of build.logs) console.error(message)
  throw new Error('Desktop backend compilation failed')
}
if (targetPlatform !== 'win32') await chmod(output, 0o755)
const transformers = await realpath(join(root, 'packages', 'providers', 'node_modules', '@huggingface', 'transformers'))
const onnxRuntime = await realpath(join(transformers, '..', '..', 'onnxruntime-node'))
await cp(join(onnxRuntime, 'bin', 'napi-v3', targetPlatform, targetArch), runtimeOutput, { recursive: true, dereference: true })
// Bun embeds native .node modules in a virtual path. Keep ONNX on disk so its
// matching shared libraries are resolved, rather than Windows' system ONNX DLL.
const transformerOutput = join(dirname(output), 'transformers-runtime')
const transformerBuild = await Bun.build({
  entrypoints: [join(transformers, 'dist', 'transformers.node.mjs')],
  outdir: transformerOutput,
  naming: 'transformers.mjs',
  target: 'node',
  external: ['onnxruntime-node', 'onnxruntime-common'],
  plugins: [{ name: 'text-only-sharp', setup(builder) { builder.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpStub })) } }],
})
if (!transformerBuild.success) throw new Error(`Transformers runtime build failed: ${transformerBuild.logs.join('\n')}`)
const onnxOutput = join(transformerOutput, 'node_modules', 'onnxruntime-node')
await mkdir(onnxOutput, { recursive: true })
for (const path of ['package.json', 'dist']) await cp(join(onnxRuntime, path), join(onnxOutput, path), { recursive: true, dereference: true })
await cp(runtimeOutput, join(onnxOutput, 'bin', 'napi-v3', targetPlatform, targetArch), { recursive: true })
const onnxCommon = dirname(createRequire(join(onnxRuntime, 'package.json')).resolve('onnxruntime-common'))
const commonRoot = resolve(onnxCommon, '..', '..')
const commonOutput = join(transformerOutput, 'node_modules', 'onnxruntime-common')
await mkdir(commonOutput, { recursive: true })
for (const path of ['package.json', 'dist']) await cp(join(commonRoot, path), join(commonOutput, path), { recursive: true, dereference: true })
// PDF.js resolves both pdf.worker.mjs and the native canvas from its own on-disk module location.
const pdfjs = await realpath(join(root, 'packages', 'platform', 'node_modules', 'pdfjs-dist'))
const pdfRuntime = join(dirname(output), 'pdf-runtime', 'node_modules')
const pdfOutput = join(pdfRuntime, 'pdfjs-dist')
await mkdir(join(pdfOutput, 'legacy', 'build'), { recursive: true })
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await cp(join(pdfjs, 'legacy', 'build', file), join(pdfOutput, 'legacy', 'build', file))
for (const path of ['package.json', 'LICENSE', 'standard_fonts', 'cmaps', 'wasm']) await cp(join(pdfjs, path), join(pdfOutput, path), { recursive: true, dereference: true })
const pdfRequire = createRequire(join(pdfjs, 'package.json'))
const canvas = dirname(pdfRequire.resolve('@napi-rs/canvas/package.json'))
const nativePlatform = targetPlatform === 'win32' ? `win32-${targetArch}-msvc` : targetPlatform === 'linux' ? `linux-${targetArch}-gnu` : `darwin-${targetArch}`
const nativeName = `@napi-rs/canvas-${nativePlatform}`
const canvasRequire = createRequire(join(canvas, 'package.json'))
const native = dirname(canvasRequire.resolve(`${nativeName}/package.json`))
await cp(canvas, join(pdfRuntime, '@napi-rs', 'canvas'), { recursive: true, dereference: true, filter: source => !source.includes(`${join(canvas, 'node_modules')}`) })
await cp(native, join(pdfRuntime, ...nativeName.split('/')), { recursive: true, dereference: true })
console.log(`Compiled desktop backend (${targetPlatform}-${targetArch}): ${output}`)
