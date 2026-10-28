import fs from 'node:fs';
import path from 'node:path';

// Copy only an installed package's runtime closure. Do not ship the full
// development node_modules directory, npm caches, user profiles or source/build
// paths. `skip` excludes optional platform builds that this package cannot load.
export function copyRuntimePackages(names,from,workspace,{skip=()=>false}={}) {
 const copied=new Map();
 const resolvePackage=(name,from)=>{
  for(let directory=from;;directory=path.dirname(directory)){
   const candidate=path.join(directory,'node_modules',name);
   if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
   if(directory===path.dirname(directory))return null;
  }
 };
 const copyPackage=(name,from,optional=false)=>{
  if(optional&&skip(name))return;
  const source=resolvePackage(name,from);if(!source){if(optional)return;throw new Error('Missing runtime dependency: '+name);}
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
  if(copied.has(name)){if(copied.get(name)!==pkg.version)throw new Error('Conflicting runtime dependency: '+name);return;}
  copied.set(name,pkg.version);
  fs.cpSync(source,path.join(workspace,'node_modules',name),{recursive:true,dereference:true,filter:file=>!['node_modules','.git'].includes(path.basename(file))});
  for(const dependency of Object.keys(pkg.dependencies||{}))copyPackage(dependency,source);
  for(const dependency of Object.keys(pkg.optionalDependencies||{}))copyPackage(dependency,source,true);
 };
 for(const name of names)copyPackage(name,from);
 return copied;
}
