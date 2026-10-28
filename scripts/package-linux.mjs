import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { auditDistribution } from './audit-distribution.mjs';
import { copyRuntimePackages } from './runtime-packages.mjs';

const root=path.resolve(import.meta.dirname,'..');
if(process.platform!=='linux'||!['x64','arm64'].includes(process.arch))throw new Error('Package and test on Linux x64 or arm64.');
const glibc=!!process.report.getReport().header.glibcVersionRuntime;
if(!glibc)throw new Error('The official Node runtime and the packaged image codec require a glibc Linux distribution.');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const runtime=path.join(root,'.build/node-runtime/bin/node');
const lock=JSON.parse(fs.readFileSync(path.join(root,'desktop/node-runtime.json'))).releases[`linux-${process.arch}`];
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(digest(runtime)!==lock.binarySha256)throw new Error('The official Node runtime checksum does not match.');
const app=path.join(root,'.build/staging-linux/banana-studio');
fs.rmSync(app,{recursive:true,force:true});fs.mkdirSync(app,{recursive:true});

const linux=path.join(root,'desktop/linux');
const shell=path.join(app,'shell');fs.mkdirSync(shell);
for(const file of ['banana_studio.py','studio_window.py','workspace_process.py','key_vault.py','window_placement.py','check_dependencies.py'])fs.copyFileSync(path.join(linux,file),path.join(shell,file));
for(const file of ['banana-studio','install.sh']){fs.copyFileSync(path.join(linux,file),path.join(app,file));fs.chmodSync(path.join(app,file),0o755);}
fs.copyFileSync(path.join(linux,'com.bananastudio.BananaStudio.desktop'),path.join(app,'com.bananastudio.BananaStudio.desktop'));
// Reuse the existing app artwork so the launcher, taskbar and window match Mac/Windows.
for(const size of [192,512]){const icons=path.join(app,`icons/hicolor/${size}x${size}/apps`);fs.mkdirSync(icons,{recursive:true});fs.copyFileSync(path.join(root,`public/icon-${size}.png`),path.join(icons,'com.bananastudio.BananaStudio.png'));}

fs.mkdirSync(path.join(app,'runtime'),{recursive:true});fs.copyFileSync(runtime,path.join(app,'runtime/node'));fs.chmodSync(path.join(app,'runtime/node'),0o755);
const nodeLicense=path.join(root,'.build/node-runtime/LICENSE');
if(digest(nodeLicense)!==lock.licenseSha256)throw new Error('The runtime license checksum does not match.');
fs.copyFileSync(nodeLicense,path.join(app,'Node-LICENSE.txt'));
const workspace=path.join(app,'workspace');fs.mkdirSync(workspace,{recursive:true});
fs.copyFileSync(path.join(root,'.build/desktop/server.mjs'),path.join(workspace,'server.mjs'));
fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({name:'banana-studio-local-runtime',private:true,type:'module'}));
fs.cpSync(path.join(root,'dist'),path.join(workspace,'web'),{recursive:true});

// npm installs sharp's musl builds beside the glibc ones; only the glibc build
// for this architecture can load with the official glibc Node runtime.
const copied=copyRuntimePackages(['sharp'],root,workspace,{skip:name=>name.startsWith('@img/')&&!name.endsWith(`-linux-${process.arch}`)});
if(!copied.has(`@img/sharp-linux-${process.arch}`)||!copied.has(`@img/sharp-libvips-linux-${process.arch}`))throw new Error('The Linux image codec is missing.');
fs.copyFileSync(path.join(root,'LICENSE'),path.join(app,'LICENSE.txt'));
fs.copyFileSync(path.join(root,'docs/THIRD_PARTY_NOTICES.md'),path.join(app,'THIRD_PARTY_NOTICES.md'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(app,'release.json'),JSON.stringify({version,sourceCommit,platform:`linux-${process.arch}`,distribution:'unsigned-community',runtimePackages:Object.fromEntries(copied)},null,2));
const audit=auditDistribution(app);if(!audit.ok)throw new Error('Distribution audit rejected the Linux package: '+JSON.stringify(audit.findings));
console.log(JSON.stringify({app,version,sourceCommit,files:audit.files}));
