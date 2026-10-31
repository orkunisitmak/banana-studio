import fs from 'node:fs';
import path from 'node:path';

/** Copy an installed runtime closure, retaining notices and rejecting conflicts. */
export function copyRuntimePackages(name, from, destination) {
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
  fs.cpSync(source,path.join(destination,name),{recursive:true,dereference:true,filter:file=>!['node_modules','.git'].includes(path.basename(file))});
  for(const dependency of Object.keys(pkg.dependencies||{}))copyPackage(dependency,source);
  for(const dependency of Object.keys(pkg.optionalDependencies||{}))copyPackage(dependency,source,true);
 };
 copyPackage(name,from);
 return copied;
}
