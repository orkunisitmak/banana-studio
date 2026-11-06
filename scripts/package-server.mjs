// Stage the self-hosted server (the Docker image's /app): the bundled workspace
// server, the built web interface and only sharp's installed runtime closure for
// this platform. Run after `npm run build` and `npm run build:desktop`.
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const target=path.resolve(process.argv[2]||path.join(root,'.build/server'));
for(const input of ['.build/desktop/server.mjs','dist/index.html'])if(!fs.existsSync(path.join(root,input)))throw new Error(`Missing ${input}. Run npm run build and npm run build:desktop first.`);
fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(root,'.build/desktop/server.mjs'),path.join(target,'server.mjs'));
fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'banana-studio-server-runtime',private:true,type:'module'}));
fs.cpSync(path.join(root,'dist'),path.join(target,'web'),{recursive:true});

const copied=new Map();
const resolvePackage=(name,from)=>{
  for(let directory=from;;directory=path.dirname(directory)){
    const candidate=path.join(directory,'node_modules',name);
    if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
    if(directory===path.dirname(directory))return null;
  }
};
const copyPackage=(name,from,optional=false)=>{
  const source=resolvePackage(name,from);if(!source){if(optional)return;throw new Error('Missing runtime dependency: '+name);}
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
  if(copied.has(name)){if(copied.get(name)!==pkg.version)throw new Error('Conflicting runtime dependency: '+name);return;}
  copied.set(name,pkg.version);
  fs.cpSync(source,path.join(target,'node_modules',name),{recursive:true,dereference:true,filter:file=>!['node_modules','.git'].includes(path.basename(file))});
  for(const dependency of Object.keys(pkg.dependencies||{}))copyPackage(dependency,source);
  // npm installs only the optional binaries that match this platform.
  for(const dependency of Object.keys(pkg.optionalDependencies||{}))copyPackage(dependency,source,true);
};
copyPackage('sharp',root);
if(![...copied.keys()].some(name=>name.startsWith(`@img/sharp-${process.platform}`)))throw new Error(`The ${process.platform}-${process.arch} image codec is missing.`);
console.log(`Staged the self-hosted server in ${path.relative(root,target)||'.'} (${[...copied].map(([n,v])=>n+'@'+v).join(', ')}).`);
