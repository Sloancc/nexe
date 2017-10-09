import { createHash } from 'crypto'
import * as path from 'path'

export interface EmbedNodeModuleOptions {
  [key: string]: { additionalFiles: string[] } | true
}

function hashName(name: string | Buffer) {
  return createHash('md5')
    .update(name)
    .digest('hex')
    .toString()
    .slice(0, 8)
}

export function embedDotNode(
  options: EmbedNodeModuleOptions,
  file: { contents: string; absPath: string }
) {
  const contents = fs.readFileSync(file.absPath)
  const modulePathParts = file.absPath.split(path.sep).reverse()
  const module = modulePathParts[modulePathParts.findIndex(x => x === 'node_modules') - 1]
  const bindingName = path.basename(file.absPath)
  const settings = options[module]
  const moduleDir = hashName(contents)
  file.contents = `
  var fs=require('fs');
  var path=require('path');
  function exists (path) { try { fs.accessSync(path); return true; } catch (e) { void e; return false }};
  function mkdirp(r,t){t=t||null,r=path.resolve(r);try{fs.mkdirSync(r),t=t||r}catch(c){if("ENOENT"===c.code)t=mkdirp(path.dirname(r),t),mkdirp(r,t);else{var i;try{i=fs.statSync(r)}catch(r){throw c}if(!i.isDirectory())throw c}}return t};`

  if (!settings || settings === true) {
    file.contents += `
      var bindingPath = path.join(process.cwd(), '${moduleDir}', '${bindingName}')
      if (!exists(bindingPath)) {
        mkdirp('${moduleDir}');
        require('fs').writeFileSync(bindingPath, fs.readFileSync(path.join('./nexe/native', '${moduleDir}', '${bindingName}')))
      }
      process.dlopen(module, bindingPath)
    `.trim()
    return [
      [`./nexe/native/${moduleDir}/${bindingName}`, contents]
    ]
  }

  let depth = 0
  settings.additionalFiles.forEach(file => {
    let ownDepth = 0
    path.normalize(file).split(path.sep).forEach(x => x === '..' && ownDepth++)
    depth = ownDepth > depth ? ownDepth : depth
  })
  let segments = [moduleDir]
  while (depth--) {
    segments.push(hashName(moduleDir + depth))
  }
  segments.push(bindingName)
  const files = ['./nexe/native/']
  file.contents += `
    var cwd = process.cwd()
    var bindingFileParts = ${JSON.stringify(segments)};
    var bindingFile = path.join.apply(path, [cwd].concat(bindingFileParts));
    if (!exists(bindingFile)) {
      mkdirp(path.dirname(bindingFile));
      fs.writeFileSync(bindingFile, fs.readFileSync(path.join('./nexe/native', '${moduleDir}', '${bindingName}')));
    }
    ${settings.additionalFiles.reduce((code, filename, i) => {
      const contents = fs.readFileSync(path.join(path.dirname(file.absPath), filename))
      return (code += `
        var file${i} = '${contents.toString('base64')}';
        var filePath${i} = path.join(cwd, bindingFileParts[0], '${filename.split('../').join('')}');
        mkdirp(path.dirname(filePath${i}));
        fs.writeFileSync(filePath${i}, Buffer.from(file${i}, 'base64'));
      `)
    }, '')};
    process.dlopen(module, bindingFile)
  `
}
