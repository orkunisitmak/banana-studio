import { signMacRelease } from './sign-macos-release.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const development=process.argv.includes('--development');
const community=process.argv.includes('--community');
const prepare=process.argv.includes('--prepare');
if((development&&community)||(prepare&&!community))throw new Error('Choose --development, --community, or the notarized default. --prepare is only supported with --community.');
const runtime=process.env.BANANA_NODE_RUNTIME;
if(!runtime||!fs.existsSync(runtime))throw new Error('Set BANANA_NODE_RUNTIME to a verified official Node.js 24 runtime for the target architecture.');
const runtimeLock=JSON.parse(fs.readFileSync(path.join(root,'desktop/node-runtime.json')));
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const verified=runtimeLock.releases[`darwin-${process.arch}`];
const nodeLicense=path.join(path.dirname(path.dirname(runtime)),'LICENSE');
if(process.platform!=='darwin'||!verified||digest(runtime)!==verified.binarySha256||!fs.existsSync(nodeLicense)||digest(nodeLicense)!==verified.licenseSha256)throw new Error('Runtime architecture or license checksum does not match the pinned official release for this Mac.');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new Error('Use a semantic application version.');
const build=process.env.BANANA_BUILD_NUMBER||(development?'1':'');if(!/^\d+$/.test(build)||!Number.isSafeInteger(Number(build))||Number(build)<1)throw new Error('Use a monotonically increasing positive numeric build number.');
if(!development&&!community&&(!process.env.BANANA_SIGNING_IDENTITY||!process.env.BANANA_NOTARY_PROFILE))throw new Error('Notarized packaging requires Developer ID and notarization credentials. Choose --community for a release that users approve in macOS Privacy & Security.');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const distribution=development?'development':community?'community':'notarized';
const staging=path.join(root,'.build/staging');const app=path.join(staging,'Banana Studio.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources');
fs.rmSync(app,{recursive:true,force:true});fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});fs.mkdirSync(path.join(contents,'Frameworks'),{recursive:true});fs.mkdirSync(path.join(resources,'runtime'),{recursive:true});fs.mkdirSync(path.join(resources,'workspace'),{recursive:true});
const swiftOutput=execFileSync('swift',['build','--package-path',path.join(root,'desktop/macos'),'-c','release','--show-bin-path'],{encoding:'utf8'}).trim();
fs.copyFileSync(path.join(swiftOutput,'BananaStudio'),path.join(contents,'MacOS/BananaStudio'));fs.chmodSync(path.join(contents,'MacOS/BananaStudio'),0o755);
execFileSync('/usr/bin/strip',['-S',path.join(contents,'MacOS/BananaStudio')]);
fs.cpSync(path.join(swiftOutput,'Sparkle.framework'),path.join(contents,'Frameworks/Sparkle.framework'),{recursive:true,dereference:false,verbatimSymlinks:true});
fs.copyFileSync(runtime,path.join(resources,'runtime/node'));fs.chmodSync(path.join(resources,'runtime/node'),0o755);
fs.copyFileSync(path.join(root,'.build/desktop/server.mjs'),path.join(resources,'workspace/server.mjs'));
fs.writeFileSync(path.join(resources,'workspace/package.json'),JSON.stringify({name:'banana-studio-local-runtime',private:true,type:'module'}));
fs.cpSync(path.join(root,'dist'),path.join(resources,'workspace/web'),{recursive:true});
const copied=[]; // macOS ImageIO handles raster encoding; no native image libraries are bundled.
// The Claude plan provider falls back to the SDK's own native build when Claude Code is not installed.
const claudeSdk=`@anthropic-ai/claude-agent-sdk-darwin-${process.arch}`;
const claudeSdkSource=path.join(root,'node_modules',claudeSdk);
if(!fs.existsSync(path.join(claudeSdkSource,'package.json')))throw new Error('Missing runtime dependency: '+claudeSdk);
const claudeSdkTarget=path.join(resources,'workspace','node_modules',claudeSdk);
fs.mkdirSync(path.dirname(claudeSdkTarget),{recursive:true});
fs.cpSync(claudeSdkSource,claudeSdkTarget,{recursive:true,dereference:true});
copied.push(claudeSdk);
const assertContained=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink()){const link=fs.readlinkSync(file);if(path.isAbsolute(link)||!fs.realpathSync(file).startsWith(app+path.sep))throw new Error('An app dependency has an external symlink. Packaging stopped.');}else if(entry.isDirectory())assertContained(file);}};
assertContained(app);
const iconset=path.join(root,'.build/BananaStudio.iconset');fs.mkdirSync(iconset,{recursive:true});for(const size of [16,32,128,256,512])for(const scale of [1,2]){
 const actual=size*scale;const target=path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`);execFileSync('/usr/bin/sips',['-z',String(actual),String(actual),path.join(root,'public/icon-512.png'),'--out',target],{stdio:'ignore'});
}
execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(resources,'BananaStudio.icns')]);
const publicKey=fs.readFileSync(path.join(root,'desktop/macos/Resources/SparklePublicKey.txt'),'utf8').trim();if(Buffer.from(publicKey,'base64').length!==32)throw new Error('A valid Sparkle public key is required.');
fs.writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.bananastudio.app</string>
<key>CFBundleName</key><string>Banana Studio</string><key>CFBundleDisplayName</key><string>Banana Studio</string>
<key>CFBundleExecutable</key><string>BananaStudio</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${build}</string>
<key>CFBundleIconFile</key><string>BananaStudio</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>LSMultipleInstancesProhibited</key><true/>
<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>SUFeedURL</key><string>https://github.com/orkunisitmak/banana-studio/releases/latest/download/appcast-${process.arch}.xml</string>
<key>SUPublicEDKey</key><string>${publicKey}</string><key>SUSendProfileInfo</key><false/>
<key>SUEnableAutomaticChecks</key><${development?'false':'true'}/><key>SUAutomaticallyUpdate</key><true/>
<key>SUVerifyUpdateBeforeExtraction</key><true/><key>SURequireSignedFeed</key><true/>
<key>BananaDevelopmentBuild</key><${development?'true':'false'}/>
<key>BananaDistribution</key><string>${distribution}</string>
<key>BananaArchitecture</key><string>${process.arch}</string>
<key>BananaSourceCommit</key><string>${sourceCommit}</string>
<key>NSHumanReadableCopyright</key><string>Copyright 2026 Banana Studio contributors. MIT License.</string>
</dict></plist>\n`);
execFileSync(process.execPath,[path.join(root,'scripts/third-party-notices.mjs')],{stdio:'inherit'});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(resources,'LICENSE'));
fs.copyFileSync(path.join(root,'docs/THIRD_PARTY_NOTICES.md'),path.join(resources,'THIRD_PARTY_NOTICES.md'));
fs.copyFileSync(nodeLicense,path.join(resources,'Node-LICENSE.txt'));
if(development){execFileSync('/usr/bin/codesign',['--force','--options','runtime','--sign','-','--entitlements',path.join(root,'desktop/macos/Resources/Node.entitlements'),path.join(resources,'runtime/node')],{stdio:'inherit'});execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});}
else { console.log(JSON.stringify(signMacRelease(app,{community,prepare}),null,2)); }
console.log(JSON.stringify({app,development,distribution,architecture:process.arch,sourceCommit,version,build,runtimePackages:[...copied]},null,2));
