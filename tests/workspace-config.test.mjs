import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCloudPublicConfig } from '../src/lib/config/publicConfig.ts';
import { assertPublicEnvironment } from '../scripts/buildSecurity.ts';
const publicKey='sb_'+'publishable_'+'example'.repeat(4);
const config=(extra={})=>({mode:'cloud',supabaseUrl:'https://example.invalid',supabasePublishableKey:publicKey,...extra});
test('public configuration allowlists fields and rejects private credentials',()=>{
 const secret='sk-'+'synthetic'.repeat(6);
 assert.deepEqual(validateCloudPublicConfig(config({OPENAI_API_KEY:secret,serviceRoleKey:secret})),config());
 for(const value of [secret,'sb_'+'secret_'+'example'.repeat(5),'','not a key'])assert.throws(()=>validateCloudPublicConfig(config({supabasePublishableKey:value})));
 const token=role=>['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
 assert.equal(validateCloudPublicConfig(config({supabasePublishableKey:token('anon')})).supabasePublishableKey,token('anon'));
 assert.throws(()=>validateCloudPublicConfig(config({supabasePublishableKey:token('service_role')})));
});
test('cloud setup requires secure, credential-free origins and never supplies a fallback',()=>{
 for(const value of [undefined,{},config({mode:'other'}),config({supabaseUrl:'http://example.invalid'}),config({supabaseUrl:'https://user:password@example.invalid'}),config({supabaseUrl:'https://example.invalid/path'}),config({supabaseUrl:'https://example.invalid?token=example'})])assert.throws(()=>validateCloudPublicConfig(value));
 assert.equal(validateCloudPublicConfig(config({supabaseUrl:'http://127.0.0.1:54321'})).supabaseUrl,'http://127.0.0.1:54321');
});
test('browser build refuses credential environment variables without echoing their contents',()=>{
 const canary='private-canary-'+Math.random().toString(36).slice(2);
 assert.throws(()=>assertPublicEnvironment({VITE_PROVIDER_KEY:canary}),error=>!error.message.includes(canary));
 assert.doesNotThrow(()=>assertPublicEnvironment({OPENAI_API_KEY:canary,VITE_APP_TITLE:'Banana Studio'}));
});

test('the browser secret guard ignores kebab-case names that contain "sk-"', () => {
  const name = ['task', 'list', 'item', 'checkbox', 'container', 'wrapper', 'large'].join('-');
  assert.doesNotThrow(() => assertPublicEnvironment({ VITE_THEME: name }));
  assert.doesNotThrow(() => assertPublicEnvironment({ VITE_THEME: 'dark-sk-' + 'A'.repeat(30) }));
  assert.throws(() => assertPublicEnvironment({ VITE_THEME: ['sk', 'proj', 'A'.repeat(40)].join('-') }));
  // Other key shapes keep matching even when glued to a word character.
  assert.throws(() => assertPublicEnvironment({ VITE_THEME: 'x' + 'AIza' + 'A'.repeat(40) }));
  assert.throws(() => assertPublicEnvironment({ VITE_THEME: 'x' + 'sb_secret_' + 'A'.repeat(24) }));
});
