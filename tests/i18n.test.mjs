import test from 'node:test';
import assert from 'node:assert/strict';
import {messages,initialLanguage,translate,LANGUAGE_STORAGE_KEY} from '../src/lib/i18n/messages.ts';
const placeholders=text=>[...text.matchAll(/\{([\w]+)\}/g)].map(m=>m[1]).sort();
test('both languages contain every interface key and matching placeholders',()=>{
 assert.deepEqual(Object.keys(messages.tr).sort(),Object.keys(messages.en).sort());
 for(const key of Object.keys(messages.en)){assert.ok(messages.tr[key].trim());assert.deepEqual(placeholders(messages.tr[key]),placeholders(messages.en[key]));}
});
test('saved valid preference wins, otherwise browser language is used even when storage fails',()=>{
 assert.equal(initialLanguage({getItem:key=>{assert.equal(key,LANGUAGE_STORAGE_KEY);return 'en';}},'tr-TR'),'en');
 assert.equal(initialLanguage({getItem:()=>null},'tr-TR'),'tr');
 assert.equal(initialLanguage({getItem:()=>{throw new Error('private mode');}},'tr'),'tr');
 assert.equal(initialLanguage({getItem:()=>'<invalid>'},'de-DE'),'en');assert.equal(initialLanguage(undefined,'en-US'),'en');
});
test('interpolation preserves values as text and leaves missing placeholders visible',()=>{
 assert.equal(translate('tr','welcome',{name:'<script>İpek</script>'}),'Hoş geldin, <script>İpek</script>');
 assert.equal(translate('en','welcome'),'Welcome, {name}');assert.equal(translate('tr','generateImage'),'Görsel üret');
});
